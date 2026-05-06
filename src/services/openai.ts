import OpenAI from "openai";
import fs from "fs/promises";
import { createReadStream } from "fs";
import os from "os";
import path from "path";
import { config } from "../config.js";

const client = new OpenAI({ apiKey: config.openaiApiKey });

export async function transcribeAudio(buffer: Buffer): Promise<string> {
  const tempFile = path.join(os.tmpdir(), `audio-${Date.now()}.ogg`);
  await fs.writeFile(tempFile, buffer);
  try {
    const response = await client.audio.transcriptions.create({
      file: createReadStream(tempFile),
      model: "gpt-4o-mini-transcribe",
      language: config.systemLanguage
    });
    return response.text || "";
  } finally {
    await fs.unlink(tempFile).catch(() => undefined);
  }
}

export async function generateText(prompt: string, context: string): Promise<string> {
  const response = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Voce e um assistente que explica legislacao brasileira de forma clara, sem dar conselhos perigosos. " +
              "Quando faltar dados, peça ao usuario a cidade/estado ou localizacao. " +
              "Use o contexto fornecido com contatos oficiais e responda de forma objetiva."
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
  const response = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: config.defaultVoice,
    input: text
  });

  return Buffer.from(await response.arrayBuffer());
}
