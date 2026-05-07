import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  masterPhone: process.env.MASTER_PHONE || "",
  ttsEnabled: (process.env.TTS_ENABLED || "true").toLowerCase() === "true",
  defaultVoice: process.env.DEFAULT_VOICE || "onyx",
  systemLanguage: process.env.SYSTEM_LANGUAGE || "pt-BR",
  googleApiKey: process.env.GOOGLE_API_KEY || "",
  googleCseId: process.env.GOOGLE_CSE_ID || "",
  newsSearchEnabled: (process.env.NEWS_SEARCH_ENABLED || "true").toLowerCase() === "true",
  newsAllowedDomains: (process.env.NEWS_ALLOWED_DOMAINS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
};
