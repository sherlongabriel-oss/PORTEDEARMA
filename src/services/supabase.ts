import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let client: SupabaseClient | null = null;
let initError: string | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (client || initError) {
    return client;
  }

  try {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });
  } catch (error) {
    initError = (error as Error).message || "Failed to init Supabase";
    logger.error({ error }, "Supabase init failed");
  }

  return client;
}

export function getSupabaseInitError(): string | null {
  return initError;
}
