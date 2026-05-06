import { getSupabaseClient } from "./supabase.js";

export interface CACDocument {
  id: string;
  owner_jid: string;
  doc_type: string;
  due_date: string;
  status: string;
  notes: string | null;
}

export async function addCACDocument(ownerJid: string, docType: string, dueDate: string, notes?: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.from("cac_documents").insert({
    owner_jid: ownerJid,
    doc_type: docType,
    due_date: dueDate,
    status: "ativo",
    notes: notes || null
  });

  return !error;
}

export async function listCACDocuments(ownerJid: string): Promise<CACDocument[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("cac_documents")
    .select("id,owner_jid,doc_type,due_date,status,notes")
    .eq("owner_jid", ownerJid)
    .order("due_date", { ascending: true })
    .limit(30);

  if (error || !data) {
    return [];
  }

  return data as CACDocument[];
}

export async function listExpiringCACDocuments(ownerJid: string, days = 30): Promise<CACDocument[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const today = new Date();
  const limit = new Date(today);
  limit.setDate(limit.getDate() + days);

  const { data, error } = await supabase
    .from("cac_documents")
    .select("id,owner_jid,doc_type,due_date,status,notes")
    .eq("owner_jid", ownerJid)
    .gte("due_date", today.toISOString().slice(0, 10))
    .lte("due_date", limit.toISOString().slice(0, 10))
    .order("due_date", { ascending: true })
    .limit(30);

  if (error || !data) {
    return [];
  }

  return data as CACDocument[];
}
