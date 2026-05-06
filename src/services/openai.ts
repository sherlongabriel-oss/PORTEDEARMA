import OpenAI from "openai";
import fs from "fs/promises";
import { createReadStream } from "fs";
import os from "os";
import path from "path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let missingKeyWarned = false;

function getOpenAIClient(): OpenAI | null {
  if (!config.openaiApiKey) {
    if (!missingKeyWarned) {
      logger.warn("OPENAI_API_KEY nao configurada. Recursos de IA ficaram indisponiveis.");
      missingKeyWarned = true;
    }
    return null;
  }
  return new OpenAI({ apiKey: config.openaiApiKey });
}

export async function transcribeAudio(buffer: Buffer): Promise<string> {
  const client = getOpenAIClient();
  if (!client) {
    return "";
  }

  const tempFile = path.join(os.tmpdir(), `audio-${Date.now()}.ogg`);
  await fs.writeFile(tempFile, buffer);
  try {
    const language = config.systemLanguage.toLowerCase().startsWith("pt") ? "pt" : undefined;

    try {
      const response = await client.audio.transcriptions.create({
        file: createReadStream(tempFile),
        model: "gpt-4o-mini-transcribe",
        language
      });
      return response.text || "";
    } catch (firstError) {
      logger.warn({ error: firstError }, "Falha no gpt-4o-mini-transcribe. Tentando whisper-1.");
      const fallback = await client.audio.transcriptions.create({
        file: createReadStream(tempFile),
        model: "whisper-1",
        language
      });
      return fallback.text || "";
    }
  } finally {
    await fs.unlink(tempFile).catch(() => undefined);
  }
}

export async function generateText(prompt: string, context: string): Promise<string> {
  const client = getOpenAIClient();
  if (!client) {
    return "No momento estou sem integracao de IA. Configure OPENAI_API_KEY para habilitar respostas inteligentes.";
  }

  const response = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Voce e um assistente especializado em legislacao brasileira sobre armas, CAC, transporte, porte, posse, registro, guias e fiscalizacao. " +
              "Responda de forma tecnica, clara e objetiva, sem incentivar condutas ilegais ou perigosas. " +
              "Priorize o contexto MyShooting IA e dados oficiais fornecidos. " +
              "Nao invente numero de artigo, lei, decreto, portaria ou prazo. " +
              "Se o contexto nao trouxer base suficiente, diga explicitamente que nao ha base suficiente para afirmar com seguranca e peca dados complementares. " +
              "Sempre que possivel, cite o fundamento legal (lei/decreto/norma) em linguagem simples. " +
              "Se houver duvida, conflito normativo, mudanca recente ou falta de contexto, diga isso explicitamente e oriente o usuario a confirmar em fontes oficiais (PF, Exercito, Diario Oficial). " +
              "Quando o pedido for sobre unidade mais proxima (ex.: delegacia), e faltar localizacao, peça cidade/UF ou localizacao em tempo real. " +
              "Use o contexto fornecido com contatos oficiais e responda em portugues do Brasil."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Contexto:\n${context}\n\nPedido:\n${prompt}`
          }
        ]
      }
    ]
  });

  const output = response.output_text;
  return output || "";
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const client = getOpenAIClient();
  if (!client) {
    return Buffer.from("");
  }

  const response = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: config.defaultVoice,
    input: text
  });

  return Buffer.from(await response.arrayBuffer());
}
