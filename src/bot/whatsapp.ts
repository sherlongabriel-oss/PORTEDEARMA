import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
  proto
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { generateText, synthesizeSpeech, transcribeAudio } from "../services/openai.js";
import { buildMapsLink, queryKnowledge } from "../services/knowledge.js";

function normalizePhone(jid: string): string {
  return jid.replace(/[^0-9]/g, "");
}

function isMaster(jid: string): boolean {
  return normalizePhone(jid) === normalizePhone(config.masterPhone);
}

async function getTextFromMessage(message: any): Promise<{ text: string; isAudio: boolean; location?: { lat: number; lng: number } }> {
  if (message?.conversation) {
    return { text: message.conversation, isAudio: false };
  }
  if (message?.extendedTextMessage?.text) {
    return { text: message.extendedTextMessage.text, isAudio: false };
  }
  if (message?.locationMessage) {
    const { degreesLatitude, degreesLongitude } = message.locationMessage;
    return {
      text: "localizacao recebida",
      isAudio: false,
      location: { lat: degreesLatitude, lng: degreesLongitude }
    };
  }
  if (message?.audioMessage) {
    const buffer = await downloadMediaMessage(
      message as proto.IWebMessageInfo,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: async () => message as proto.IWebMessageInfo
      }
    );
    const transcript = await transcribeAudio(buffer as Buffer);
    return { text: transcript, isAudio: true };
  }
  return { text: "", isAudio: false };
}

function extractLocationRequest(text: string): { city?: string; state?: string } {
  const lower = text.toLowerCase();
  if (lower.includes("sp") || lower.includes("sao paulo")) {
    return { city: "Sao Paulo", state: "SP" };
  }
  return {};
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
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger
  });

  sock.ev.on("connection.update", (update) => {
    if (update.qr) {
      qrcode.generate(update.qr, { small: true });
      logger.info("QR code gerado. Apenas o usuario master deve escanear.");
    }
    if (update.connection === "close") {
      const reason = (update.lastDisconnect?.error as any)?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        void startWhatsAppBot();
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    const message = m.messages[0];
    if (!message?.message || message.key.fromMe) {
      return;
    }

    const jid = message.key.remoteJid || "";
    const { text, isAudio, location } = await getTextFromMessage(message.message);
    if (!text) {
      return;
    }

    const locationHint = extractLocationRequest(text);
    const kind = detectKind(text);

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
      await sock.sendMessage(jid, {
        audio: audioBuffer,
        mimetype: "audio/mpeg",
        ptt: true
      });
    }

    if (!isMaster(jid) && text.toLowerCase().includes("admin")) {
      await sock.sendMessage(jid, {
        text: "Apenas o usuario master pode executar comandos administrativos."
      });
    }
  });
}
