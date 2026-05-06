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
import { clearMasterJid, getMasterJid, setMasterJid } from "../services/master.js";
import { getSocket, setLastError, setQr, setSocket, setStatus } from "../services/botState.js";
import fs from "fs/promises";
import path from "path";

const authDir = path.resolve("auth");
const pendingNearestByJid = new Map<string, { kind: EntityKind; createdAt: number }>();
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
      const nearestIntent = needsNearestDelegacia(text);
      const pendingNearest = pendingNearestByJid.get(jid);

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

      const context = [knowledge, mapsHint].filter(Boolean).join("\n");
      const response = await generateText(text, context);

      await sock.sendMessage(jid, { text: response });

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
