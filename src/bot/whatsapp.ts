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
import { getMyShootingContext, getMyShootingResponseDirective, getOperationalFocusDirective, isArmsLegalTopic } from "../services/myshooting.js";
import { verifyMinAgeForPossessionOnline } from "../services/legalLookup.js";
import { resolveLegalGrounding } from "../services/legalResolver.js";
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
    "TEMA\nIdade minima para aquisicao de arma de fogo por cidadao em regra geral.",
    "COMO FUNCIONA NA PRATICA\nNa regra geral do Estatuto do Desarmamento, a idade minima exigida e 25 anos para aquisicao com finalidade de posse regular.",
    "PASSO A PASSO\n1) Confirmar se o caso e posse civil comum.\n2) Confirmar idade minima de 25 anos.\n3) Prosseguir com os demais requisitos legais e administrativos.",
    "BASE LEGAL CONFIRMADA\nLei: Lei 10.826/2003.\nDecreto: verificar regulamentacao federal vigente complementar.\nPortaria: conforme atos administrativos aplicaveis.\nArtigo: Art. 4o, inciso I.\nOrgao responsavel: Policia Federal (registro civil).",
    `NIVEL DE SEGURANCA DA INFORMACAO\nConfirmado em lei. ${verificationStatus}`,
    "ALERTAS IMPORTANTES\nInformar idade inferior como suficiente pode gerar erro material grave, indeferimento administrativo e risco de autuacao em situacoes conexas.",
    `LIMITACAO DA RESPOSTA\nPode haver regras especificas para categorias funcionais/profissionais distintas da posse civil comum. Fonte oficial: ${online.sourceUrl}`
  ].join("\n\n");
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
      "TEMA\nLimite de aquisicao de municoes.",
      "COMO FUNCIONA NA PRATICA\nNao e juridicamente seguro informar um numero fixo sem enquadramento completo (categoria, orgao competente, ato normativo vigente e finalidade).",
      "PASSO A PASSO\n1) Informe sua categoria (CAC, PF, PC, PM, Penal, GM etc.).\n2) Informe sua UF e finalidade (treino, servico, competicao).\n3) Informe o sistema/orgão do seu processo (PF ou SFPC/Exercito).\n4) Com esses dados, a resposta pode ser dada com base normativa verificavel.",
      "BASE LEGAL CONFIRMADA\nLei: Lei 10.826/2003 (Estatuto do Desarmamento).\nDecreto: confirmar ato federal vigente aplicavel ao caso concreto.\nPortaria: confirmar ato vigente do orgao competente (PF/SFPC).\nArtigo: depende do enquadramento especifico.\nOrgao responsavel: Policia Federal e/ou Comando do Exercito (conforme categoria).",
      "NIVEL DE SEGURANCA DA INFORMACAO\nSem previsao expressa (para numero unico sem categoria definida).",
      "ALERTAS IMPORTANTES\nInformar ou seguir limite numerico sem base vigente pode gerar autuacao, apreensao, infracao administrativa e responsabilizacao penal.",
      "LIMITACAO DA RESPOSTA\nNao existe previsao legal expressa de numero unico nacional aplicavel a todos os perfis sem diferenciacao de categoria e ato vigente."
    ].join("\n\n");
  }

  return [
    "TEMA\nLimite de aquisicao de municoes para categoria informada.",
    "COMO FUNCIONA NA PRATICA\nPara " + category + ", o limite depende de ato normativo vigente do orgao competente e do enquadramento administrativo do caso.",
    "PASSO A PASSO\n1) Confirmar categoria e registro ativo.\n2) Confirmar orgao competente do processo (PF ou SFPC/Exercito).\n3) Confirmar o ato normativo vigente aplicavel na data da consulta.\n4) Aplicar o limite somente com base nesse ato.",
    "BASE LEGAL CONFIRMADA\nLei: Lei 10.826/2003.\nDecreto: confirmar decreto federal vigente aplicavel.\nPortaria/IN: confirmar ato vigente do orgao competente.\nArtigo: varia conforme enquadramento e norma especifica.\nOrgao responsavel: PF e/ou Comando do Exercito.",
    "NIVEL DE SEGURANCA DA INFORMACAO\nRegulamentacao administrativa (depende de ato vigente especifico).",
    "DIFERENCAS ENTRE CATEGORIAS\nCAC, policiais e demais categorias possuem regimes administrativos distintos; nao e juridicamente seguro unificar um numero sem norma especifica vigente.",
    "ALERTAS IMPORTANTES\nSeguir numero sem base vigente pode causar autuacao, apreensao, infracao administrativa e responsabilizacao penal.",
    "LIMITACAO DA RESPOSTA\nNao ha numero confirmavel aqui sem identificacao do ato normativo vigente aplicavel ao seu caso concreto."
  ].join("\n\n");
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
      if (!text) {
        if (isAudio && jid) {
          await sock.sendMessage(jid, {
            text: "Nao consegui entender o audio. Tente falar mais perto do microfone ou envie em texto."
          });
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

      if (isMinAgePossessionQuestion(text)) {
        const fixedResponse = await buildMinAgePossessionResponse();
        await sock.sendMessage(jid, { text: fixedResponse });
        lastReplyByJid.set(jid, normalizeForCompare(fixedResponse));
        return;
      }

      if (isMunitionsLimitQuestion(text)) {
        const category = extractUserCategory(text);
        const safeReply = buildMunitionsSafeResponse(category);
        lastReplyByJid.set(jid, normalizeForCompare(safeReply));
        await sock.sendMessage(jid, { text: safeReply });
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
      const legalTopic = isArmsLegalTopic(text);

      let legalResolverContext = "";
      if (legalTopic) {
        const legalResolution = await resolveLegalGrounding(text);
        legalResolverContext = legalResolution.context;

        if (legalResolution.status === "insufficient") {
          await sock.sendMessage(jid, {
            text: [
              "TEMA\nBase juridica insuficiente para conclusao fechada no caso consultado.",
              "COMO FUNCIONA NA PRATICA\nSem norma e artigo confirmados para o ponto especifico, nao e seguro concluir com numero ou regra fechada.",
              "PASSO A PASSO\n1) Informe categoria (CAC, PF, PC, PM, Penal, GM etc.).\n2) Informe UF e contexto objetivo.\n3) Informe se deseja regra geral ou caso concreto.\n4) A resposta sera refeita com base legal confirmada.",
              "BASE LEGAL CONFIRMADA\nLei: Lei 10.826/2003 (base geral).\nArtigo/ato especifico: nao confirmado para este enunciado na base atual.",
              "NIVEL DE SEGURANCA DA INFORMACAO\nSem previsao expressa (para conclusao do caso sem dados e norma especifica).",
              "LIMITACAO DA RESPOSTA\nNao existe base normativa suficiente para afirmar conclusao fechada neste momento."
            ].join("\n\n")
          });
          return;
        }
      }

      if (legalTopic && myshooting.confidence === "low") {
        const preliminaryPrompt =
          `Pergunta do usuario: ${text}\n\n` +
          "Responda de forma objetiva, sem generalidade, com orientacao inicial pratica e juridicamente segura.";
        const preliminaryContext = [knowledge, myshooting.context, legalResolverContext, directive, operationalDirective].filter(Boolean).join("\n\n");
        const preliminary = await generateText(preliminaryPrompt, preliminaryContext);

        await sock.sendMessage(jid, {
          text:
            `${preliminary}\n\n` +
            "Para maior precisao juridica no padrao MyShooting IA, me informe: (1) tipo de situacao (porte, posse, transporte ou CAC), (2) sua UF e (3) contexto objetivo do caso."
        });
        return;
      }

      const focusedPrompt = [
        `Pergunta do usuario: ${text}`,
        "Requisito de resposta: seja especifico e operacional.",
        "Entregue: decisao pratica objetiva, base legal aplicavel, risco juridico e proximo passo acionavel.",
        "Nao use resposta generica."
      ].join("\n");

      const context = [knowledge, mapsHint, myshooting.context, legalResolverContext, directive, operationalDirective].filter(Boolean).join("\n\n");
      let response = await generateText(focusedPrompt, context);

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
