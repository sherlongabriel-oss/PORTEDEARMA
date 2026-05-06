import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  masterPhone: process.env.MASTER_PHONE || "",
  ttsEnabled: (process.env.TTS_ENABLED || "true").toLowerCase() === "true",
  defaultVoice: process.env.DEFAULT_VOICE || "alloy",
  systemLanguage: process.env.SYSTEM_LANGUAGE || "pt-BR"
};
