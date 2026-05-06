import { getSupabaseClient } from "./supabase.js";

export type EntityKind = "delegacia" | "militar" | "clube";

export interface KnowledgeQuery {
  kind?: EntityKind;
  city?: string;
  state?: string;
  freeText?: string;
}

export async function queryKnowledge(query: KnowledgeQuery): Promise<string> {
  const { kind, city, state, freeText } = query;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return "Base de dados indisponivel no momento.";
  }

  let builder = supabase
    .from("entities")
    .select("name,kind,phone,email,address,city,state,notes")
    .limit(5);

  if (kind) {
    builder = builder.eq("kind", kind);
  }
  if (city) {
    builder = builder.ilike("city", `%${city}%`);
  }
  if (state) {
    builder = builder.ilike("state", `%${state}%`);
  }
  if (freeText) {
    builder = builder.or(`name.ilike.%${freeText}%,notes.ilike.%${freeText}%`);
  }

  const { data, error } = await builder;
  if (error || !data || data.length === 0) {
    return "Sem registros no momento.";
  }

  return data
    .map((row) => {
      const parts = [
        row.name,
        row.kind,
        row.address,
        row.city,
        row.state,
        row.phone,
        row.email,
        row.notes
      ].filter(Boolean);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

export function buildMapsLink(query: string): string {
  const encoded = encodeURIComponent(query);
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}
