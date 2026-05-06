import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  useMultiFileAuthState,
  proto
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { generateText, synthesizeSpeech, transcribeAudio } from "../services/openai.js";
import { buildMapsLink, queryKnowledge, searchEntities, type EntityKind } from "../services/knowledge.js";
import { getMyShootingContext, getMyShootingResponseDirective, getOperationalFocusDirective, getStrictRegulatoryPolicyDirective, isArmsLegalTopic } from "../services/myshooting.js";
import { verifyMinAgeForPossessionOnline } from "../services/legalLookup.js";
import { resolveLegalGrounding } from "../services/legalResolver.js";
import { resolveCriticalLegalFact } from "../services/legalFacts.js";
import { addCACDocument, listCACDocuments, listExpiringCACDocuments } from "../services/cacDocuments.js";
import { buildQualityRepairPrompt, isLegalResponseComplete } from "../services/responseQuality.js";
import { clearMasterJid, getMasterJid, setMasterJid } from "../services/master.js";
import { getSocket, setLastError, setQr, setSocket, setStatus } from "../services/botState.js";
import fs from "fs/promises";
import path from "path";

const authDir = path.resolve("auth");
const pendingNearestByJid = new Map<string, { kind: EntityKind; createdAt: number }>();
const lastReplyByJid = new Map<string, string>();
let isStarting = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
let activeSessionId = 0;

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(reason: string): void {
  clearReconnectTimer();
  reconnectAttempt += 1;
  const delayMs = Math.min(30_000, 2_000 * reconnectAttempt);
  logger.warn({ reason, reconnectAttempt, delayMs }, "Agendando reconexao do WhatsApp");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startWhatsAppBot();
  }, delayMs);
}

function normalizePhone(jid: string): string {
  return jid.replace(/[^0-9]/g, "");
}

function isMaster(jid: string): boolean {
  if (config.masterPhone) {
    return normalizePhone(jid) === normalizePhone(config.masterPhone);
  }
  return false;
}

async function getTextFromMessage(messageInfo: proto.IWebMessageInfo): Promise<{ text: string; isAudio: boolean; location?: { lat: number; lng: number } }> {
  const content = messageInfo.message;

  if (content?.conversation) {
    return { text: content.conversation, isAudio: false };
  }
  if (content?.extendedTextMessage?.text) {
    return { text: content.extendedTextMessage.text, isAudio: false };
  }
  if (content?.locationMessage) {
    const { degreesLatitude, degreesLongitude } = content.locationMessage;
    const hasValidCoords = typeof degreesLatitude === "number" && typeof degreesLongitude === "number";
    return {
      text: "localizacao recebida",
      isAudio: false,
      location: hasValidCoords ? { lat: degreesLatitude, lng: degreesLongitude } : undefined
    };
  }
  if (content?.audioMessage) {
    const buffer = await downloadMediaMessage(
      messageInfo,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: async () => messageInfo
      }
    );
    const transcript = await transcribeAudio(buffer as Buffer);
    return { text: transcript, isAudio: true };
  }
  return { text: "", isAudio: false };
}

function extractLocationRequest(text: string): { city?: string; state?: string } {
  const cleaned = text.replace(/\s+/g, " ").trim();

  const cityStateMatch = cleaned.match(/(?:estou em|moro em|sou de|em)\s+([\p{L}\s]+?)(?:\s*[-/,]\s*|\s+)(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/iu);
  if (cityStateMatch) {
    return { city: cityStateMatch[1].trim(), state: cityStateMatch[2].toUpperCase() };
  }

  const stateOnly = cleaned.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
  if (stateOnly) {
    return { state: stateOnly[1].toUpperCase() };
  }

  const cityOnly = cleaned.match(/(?:estou em|moro em|sou de|em)\s+([\p{L}\s]{3,})$/iu);
  if (cityOnly) {
    return { city: cityOnly[1].trim() };
  }

  return {};
}

function needsNearestDelegacia(text: string): boolean {
  const lower = text.toLowerCase();
  const hasDelegacia = lower.includes("delegacia") || lower.includes("policia") || lower.includes("polícia");
  const asksNearest =
    lower.includes("mais proxima") ||
    lower.includes("mais próxima") ||
    lower.includes("perto") ||
    lower.includes("proxima") ||
    lower.includes("próxima");
  return hasDelegacia && asksNearest;
}

function hasAnyLocationInfo(locationHint: { city?: string; state?: string }, location?: { lat: number; lng: number }): boolean {
  return Boolean(location || locationHint.city || locationHint.state);
}

function formatEntitiesWithMaps(
  title: string,
  entities: Array<{ name: string; address?: string | null; city?: string | null; state?: string | null }>
): string {
  if (entities.length === 0) {
    return `${title}\nNao encontrei registros locais no banco agora, mas voce pode buscar no mapa:\n${buildMapsLink("delegacia perto de mim")}`;
  }

  const lines = entities.slice(0, 5).map((entity, idx) => {
    const query = [entity.name, entity.address, entity.city, entity.state].filter(Boolean).join(" ");
    const map = buildMapsLink(query);
    const label = [entity.name, entity.city, entity.state].filter(Boolean).join(" - ");
    return `${idx + 1}) ${label}\n${map}`;
  });
  return `${title}\n${lines.join("\n\n")}`;
}

function detectKind(text: string): "delegacia" | "militar" | "clube" | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("delegacia") || lower.includes("policia")) {
    return "delegacia";
  }
  if (lower.includes("militar") || lower.includes("exercito") || lower.includes("marinha")) {
    return "militar";
  }
  if (lower.includes("clube") || lower.includes("tiro")) {
    return "clube";
  }
  return undefined;
}

function normalizeForCompare(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isCorrectionFeedback(text: string): boolean {
  const lower = normalizeForCompare(text);
  return (
    lower.includes("errado") ||
    lower.includes("incorreto") ||
    lower.includes("nao esta certo") ||
    lower.includes("isso esta errado") ||
    lower.includes("resposta errada")
  );
}

function isMunitionsLimitQuestion(text: string): boolean {
  const lower = normalizeForCompare(text);
  const hasMunitions = lower.includes("municao") || lower.includes("municoes") || lower.includes("cartucho") || lower.includes("cartuchos");
  const asksQuantity =
    lower.includes("quantas") ||
    lower.includes("quantidade") ||
    lower.includes("limite") ||
    lower.includes("posso comprar") ||
    lower.includes("comprar por ano") ||
    lower.includes("comprar por mes");
  return hasMunitions && asksQuantity;
}

function isLikelyQuestion(text: string): boolean {
  const raw = text.trim();
  if (raw.includes("?")) {
    return true;
  }

  const lower = normalizeForCompare(raw);
  return [
    "qual",
    "quais",
    "quanto",
    "quantos",
    "quantas",
    "como",
    "quando",
    "onde",
    "posso",
    "devo",
    "idade",
    "limite"
  ].some((token) => lower.includes(token));
}

function isMinAgePossessionQuestion(text: string): boolean {
  const lower = normalizeForCompare(text);
  const asksAge = lower.includes("idade") || lower.includes("minima") || lower.includes("mínima");
  const hasPossession = lower.includes("posse") || lower.includes("arma");
  return asksAge && hasPossession;
}

async function buildMinAgePossessionResponse(): Promise<string> {
  const online = await verifyMinAgeForPossessionOnline();
  const verificationStatus = online.confirmed
    ? "Confirmado em fonte oficial online."
    : "Validacao online indisponivel no momento; mantendo base legal consolidada conhecida.";

  return [
    "Para posse/aquisicao civil comum de arma de fogo, a idade minima legal e 25 anos.",
    `Base legal: Lei 10.826/2003, art. 4o, inciso I; orgao competente no caso civil: Policia Federal. ${verificationStatus}`,
    "Procedimento pratico: confirmar enquadramento civil comum e, em seguida, cumprir os demais requisitos administrativos antes do protocolo.",
    `Fonte oficial: ${online.sourceUrl}`
  ].join(" ");
}

function extractUserCategory(text: string): string | null {
  const lower = normalizeForCompare(text);
  if (lower.includes("cac") || lower.includes("atirador")) {
    return "CAC (atirador/desportivo)";
  }
  if (lower.includes("colecionador")) {
    return "Colecionador";
  }
  if (lower.includes("cacador") || lower.includes("caçador")) {
    return "Cacador";
  }
  if (lower.includes("policia federal") || lower.includes("pf")) {
    return "Policia Federal";
  }
  if (lower.includes("policia civil")) {
    return "Policia Civil";
  }
  if (lower.includes("policia militar")) {
    return "Policia Militar";
  }
  if (lower.includes("policia penal")) {
    return "Policia Penal";
  }
  if (lower.includes("guarda municipal")) {
    return "Guarda Municipal";
  }
  return null;
}

function buildMunitionsSafeResponse(category: string | null): string {
  if (!category) {
    return [
      "Nao e correto informar um numero unico de municoes sem definir categoria, orgao competente e ato normativo vigente.",
      "Base geral: Lei 10.826/2003; a regra especifica depende de regulacao administrativa aplicavel (PF e/ou Comando do Exercito, conforme categoria).",
      "Para resposta exata, informe categoria, UF, finalidade e se o processo e na PF ou no SFPC/Exercito.",
      "Sem esses dados, qualquer numero fechado seria juridicamente inseguro e pode gerar autuacao, apreensao e responsabilizacao."
    ].join(" ");
  }

  return [
    `Para ${category}, o limite de municao nao deve ser informado sem vincular a ato normativo vigente do orgao competente no seu caso.`,
    "Base geral: Lei 10.826/2003; a quantificacao depende da regulacao administrativa aplicavel e da categoria funcional/administrativa.",
    "No procedimento correto, confirme categoria e registro ativos, identifique o orgao competente (PF ou SFPC/Exercito) e aplique apenas a regra vigente da data da consulta.",
    "Sem o ato especifico vigente, nao ha numero juridicamente seguro para fechar resposta."
  ].join(" ");
}

export async function startWhatsAppBot(): Promise<void> {
  if (isStarting) {
    logger.info("Inicializacao do WhatsApp ja em andamento. Ignorando chamada duplicada.");
    return;
  }

  isStarting = true;
  try {
    const sessionId = ++activeSessionId;

    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info({ version, isLatest }, "Baileys version loaded");

    const sock = makeWASocket({
      auth: state,
      browser: Browsers.windows("Desktop"),
      version,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      logger
    });

    setStatus("connecting");
    setSocket(sock);

    sock.ev.on("connection.update", (update) => {
    if (sessionId !== activeSessionId) {
      return;
    }

    if (update.qr) {
      qrcode.generate(update.qr, { small: true });
      logger.info("QR code gerado. Apenas o usuario master deve escanear.");
      setQr(update.qr);
      setStatus("connecting");
      setLastError(null);
    }
    if (update.connection === "open") {
      reconnectAttempt = 0;
      clearReconnectTimer();
      setQr(null);
      setStatus("open");
      setLastError(null);
      void (async () => {
        const existing = await getMasterJid();
        if (!existing) {
          const jid = sock.user?.id || "";
          if (jid) {
            await setMasterJid(jid);
            logger.info("Master definido pelo primeiro QR conectado.");
          }
        }
      })();
    }
    if (update.connection === "close") {
      setStatus("close");
      const err = update.lastDisconnect?.error as any;
      const msg = err?.message || err?.output?.payload?.message || "Connection closed";
      setLastError(msg);
      const reason = (update.lastDisconnect?.error as any)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        void (async () => {
          await fs.rm(authDir, { recursive: true, force: true });
          setQr(null);
          setStatus("connecting");
          setLastError("Logged out. Generating new QR.");
          scheduleReconnect("logged_out");
        })();
        return;
      }
      scheduleReconnect(String(reason || "connection_closed"));
    }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (m) => {
    const message = m.messages[0];
    if (!message?.message || message.key.fromMe) {
      return;
    }

    const jid = message.key.remoteJid || "";

    try {
      const { text, isAudio, location } = await getTextFromMessage(message);
      const sendReply = async (replyText: string): Promise<void> => {
        await sock.sendMessage(jid, { text: replyText });
        if (config.ttsEnabled && isAudio) {
          const audioBuffer = await synthesizeSpeech(replyText);
          if (audioBuffer.length > 0) {
            await sock.sendMessage(jid, {
              audio: audioBuffer,
              mimetype: "audio/mpeg",
              ptt: true
            });
          }
        }
      };

      if (!text) {
        if (isAudio && jid) {
          await sendReply("Nao consegui entender o audio. Tente falar mais perto do microfone ou envie em texto.");
        }
        return;
      }

      const locationHint = extractLocationRequest(text);
      const kind = detectKind(text);
      const lowerText = text.toLowerCase().trim();
      const correctionFeedback = isCorrectionFeedback(text);
      const likelyQuestion = isLikelyQuestion(text);
      const nearestIntent = needsNearestDelegacia(text);
      const pendingNearest = pendingNearestByJid.get(jid);

      if (!likelyQuestion && !correctionFeedback && !location && !lowerText.startsWith("admin")) {
        return;
      }

      const criticalFactResponse = resolveCriticalLegalFact(text);
      if (criticalFactResponse) {
        await sendReply(criticalFactResponse);
        lastReplyByJid.set(jid, normalizeForCompare(criticalFactResponse));
        return;
      }

      if (isMinAgePossessionQuestion(text)) {
        const fixedResponse = await buildMinAgePossessionResponse();
        await sendReply(fixedResponse);
        lastReplyByJid.set(jid, normalizeForCompare(fixedResponse));
        return;
      }

      if (isMunitionsLimitQuestion(text)) {
        const category = extractUserCategory(text);
        const safeReply = buildMunitionsSafeResponse(category);
        lastReplyByJid.set(jid, normalizeForCompare(safeReply));
        await sendReply(safeReply);
        return;
      }

      if (pendingNearest && Date.now() - pendingNearest.createdAt > 10 * 60 * 1000) {
        pendingNearestByJid.delete(jid);
      }

      if (lowerText.startsWith("admin")) {
        const masterJid = await getMasterJid();
        const isDynamicMaster = masterJid && normalizePhone(jid) === normalizePhone(masterJid);
        const allowed = isDynamicMaster || isMaster(jid);
        if (!allowed) {
          await sock.sendMessage(jid, {
            text: "Apenas o usuario master pode executar comandos administrativos."
          });
          return;
        }
        if (lowerText.includes("desconectar") || lowerText.includes("logout")) {
          await sock.sendMessage(jid, { text: "Sessao encerrada. Reconecte via QR." });
          await clearMasterJid();
          await sock.logout();
          return;
        }
        if (lowerText.includes("status")) {
          const current = masterJid || "(nao definido)";
          await sock.sendMessage(jid, { text: `Master atual: ${current}` });
          return;
        }
      }

      if (lowerText.startsWith("doc ")) {
        const parts = text.trim().split(/\s+/);
        const command = (parts[1] || "").toLowerCase();

        if (command === "add" && parts.length >= 4) {
          const dueDate = parts[parts.length - 1];
          const docType = parts.slice(2, parts.length - 1).join(" ");
          const success = await addCACDocument(jid, docType, dueDate);
          await sock.sendMessage(jid, {
            text: success
              ? `Documento registrado com sucesso. Tipo: ${docType}. Vencimento: ${dueDate}.`
              : "Nao foi possivel registrar o documento agora. Verifique a conexao com o banco."
          });
          return;
        }

        if (command === "list") {
          const docs = await listCACDocuments(jid);
          if (docs.length === 0) {
            await sock.sendMessage(jid, { text: "Nenhum documento CAC cadastrado para este usuario." });
            return;
          }
          const msg = docs
            .map((doc, idx) => `${idx + 1}) ${doc.doc_type} | venc: ${doc.due_date} | status: ${doc.status}`)
            .join("\n");
          await sock.sendMessage(jid, { text: `Documentos CAC:\n${msg}` });
          return;
        }

        if (command === "vencendo") {
          const docs = await listExpiringCACDocuments(jid, 30);
          if (docs.length === 0) {
            await sock.sendMessage(jid, { text: "Nenhum documento vencendo nos proximos 30 dias." });
            return;
          }
          const msg = docs
            .map((doc, idx) => `${idx + 1}) ${doc.doc_type} | venc: ${doc.due_date} | status: ${doc.status}`)
            .join("\n");
          await sock.sendMessage(jid, { text: `Documentos vencendo em ate 30 dias:\n${msg}` });
          return;
        }

        await sock.sendMessage(jid, {
          text: "Comandos docs: doc add <tipo> <YYYY-MM-DD> | doc list | doc vencendo"
        });
        return;
      }

      if (nearestIntent && !hasAnyLocationInfo(locationHint, location)) {
        pendingNearestByJid.set(jid, { kind: "delegacia", createdAt: Date.now() });
        await sock.sendMessage(jid, {
          text:
            "Para achar a delegacia mais proxima, me envie sua localizacao atual pelo WhatsApp ou diga sua cidade/UF (ex.: Campinas/SP)."
        });
        return;
      }

      if ((pendingNearestByJid.has(jid) || nearestIntent) && location) {
        pendingNearestByJid.delete(jid);
        const mapsLink = buildMapsLink(`delegacia perto de ${location.lat},${location.lng}`);
        await sock.sendMessage(jid, {
          text: `Delegacias proximas da sua localizacao:\n${mapsLink}`
        });
        return;
      }

      if ((pendingNearestByJid.has(jid) || nearestIntent) && (locationHint.city || locationHint.state)) {
        pendingNearestByJid.delete(jid);
        const entities = await searchEntities({
          kind: "delegacia",
          city: locationHint.city,
          state: locationHint.state
        });

        const localLabel = [locationHint.city, locationHint.state].filter(Boolean).join("/") || "sua regiao";
        await sock.sendMessage(jid, {
          text: formatEntitiesWithMaps(`Delegacias proximas em ${localLabel}:`, entities)
        });

        const mapsLink = buildMapsLink(`delegacia em ${localLabel}`);
        await sock.sendMessage(jid, {
          text: `Busca ampla no Google Maps:\n${mapsLink}`
        });
        return;
      }

      if (location) {
        const mapLink = buildMapsLink(`${location.lat},${location.lng}`);
        await sock.sendMessage(jid, {
          text: `Localizacao recebida. Mapa: ${mapLink}. Diga sua cidade/estado para buscar o contato mais proximo.`
        });
      }

      const knowledge = await queryKnowledge({
        kind,
        city: locationHint.city,
        state: locationHint.state,
        freeText: text
      });

      const mapsHint = locationHint.city
        ? buildMapsLink(`${locationHint.city} ${locationHint.state || ""}`)
        : "";
      const myshooting = getMyShootingContext(text);
      const directive = getMyShootingResponseDirective(text);
      const operationalDirective = getOperationalFocusDirective(text);
      const strictPolicyDirective = getStrictRegulatoryPolicyDirective();
      const legalTopic = isArmsLegalTopic(text);

      let legalResolverContext = "";
      if (legalTopic) {
        const legalResolution = await resolveLegalGrounding(text);
        legalResolverContext = legalResolution.context;

        if (legalResolution.status === "insufficient") {
          await sendReply(
            [
              "Nao ha base normativa suficiente, na base atual, para fechar conclusao juridica especifica sem risco de erro.",
              "Base geral identificada: Lei 10.826/2003; artigo/ato especifico para o seu enunciado ainda nao foi confirmado aqui.",
              "Para resposta exata e objetiva, envie categoria, UF e contexto concreto (regra geral ou caso pratico)."
            ].join(" ")
          );
          return;
        }
      }

      if (legalTopic && myshooting.confidence === "low") {
        const preliminaryPrompt =
          `Pergunta do usuario: ${text}\n\n` +
          "Responda de forma objetiva, sem generalidade, com orientacao inicial pratica e juridicamente segura.";
        const preliminaryContext = [knowledge, myshooting.context, legalResolverContext, directive, operationalDirective, strictPolicyDirective].filter(Boolean).join("\n\n");
        const preliminary = await generateText(preliminaryPrompt, preliminaryContext);

        await sendReply(`${preliminary}\n\nPara fechar com precisao juridica, informe categoria, UF e contexto objetivo do caso.`);
        return;
      }

      const focusedPrompt = [
        `Pergunta do usuario: ${text}`,
        "Requisito de resposta: seja especifico e operacional.",
        "Entregue: decisao pratica objetiva, base legal aplicavel, risco juridico e proximo passo acionavel.",
        "Nao use resposta generica."
      ].join("\n");

      const context = [knowledge, mapsHint, myshooting.context, legalResolverContext, directive, operationalDirective, strictPolicyDirective].filter(Boolean).join("\n\n");
      let response = await generateText(focusedPrompt, context);

      if (legalTopic && !isLegalResponseComplete(response)) {
        const repairPrompt = buildQualityRepairPrompt(text, response);
        response = await generateText(repairPrompt, context);
      }

      const normalizedResponse = normalizeForCompare(response);
      const previous = lastReplyByJid.get(jid);
      if (correctionFeedback && previous && previous === normalizedResponse) {
        const revisedPrompt =
          `O usuario informou que sua resposta anterior estava errada.\n` +
          `Pergunta atual: ${text}\n` +
          "Obrigatorio: NAO repetir a mesma resposta. Reanalise, explicite limite de confianca e peca os dados minimos faltantes.";
        response = await generateText(revisedPrompt, context);
      }

      await sock.sendMessage(jid, { text: response });
      lastReplyByJid.set(jid, normalizeForCompare(response));

      if (config.ttsEnabled && isAudio) {
        const audioBuffer = await synthesizeSpeech(response);
        if (audioBuffer.length > 0) {
          await sock.sendMessage(jid, {
            audio: audioBuffer,
            mimetype: "audio/mpeg",
            ptt: true
          });
        }
      }
    } catch (error) {
      logger.error({ error }, "Falha ao processar mensagem recebida");
      if (jid) {
        await sock.sendMessage(jid, {
          text: "Tive um erro ao processar sua mensagem. Tente novamente em alguns segundos."
        });
      }
    }

    });
  } catch (error) {
    logger.error({ error }, "Falha ao iniciar cliente WhatsApp");
    scheduleReconnect("start_error");
  } finally {
    isStarting = false;
  }
}

export async function resetWhatsAppSession(): Promise<void> {
  const sock = getSocket();
  if (sock) {
    await sock.logout();
  }
  await fs.rm(authDir, { recursive: true, force: true });
  setQr(null);
  setStatus("connecting");
  setLastError(null);
  void startWhatsAppBot();
}
