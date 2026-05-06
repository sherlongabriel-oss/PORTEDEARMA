import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  masterPhone: process.env.MASTER_PHONE || "",
  ttsEnabled: (process.env.TTS_ENABLED || "true").toLowerCase() === "true",
  defaultVoice: process.env.DEFAULT_VOICE || "alloy",
  systemLanguage: process.env.SYSTEM_LANGUAGE || "pt-BR"
};
