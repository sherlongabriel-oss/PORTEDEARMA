import { getSupabaseClient } from "./supabase.js";

type ResolverStatus = "grounded" | "insufficient" | "unavailable";

interface LegalNormRow {
  id: string;
  norm_type: string;
  norm_number: string | null;
  norm_year: number | null;
  title: string;
  issuing_body: string;
  status: string;
  official_url: string;
}

interface LegalArticleRow {
  id: string;
  norm_id: string;
  article_label: string;
  article_text: string;
}

interface LegalInterpretationRow {
  id: string;
  title: string;
  issuing_body: string;
  act_type: string;
  act_number: string | null;
  interpretation_text: string;
  official_url: string;
}

export interface LegalResolution {
  status: ResolverStatus;
  context: string;
  matchedNorms: number;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(question: string): string[] {
  const stopwords = new Set([
    "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "em", "no", "na", "nos", "nas", "por", "para", "com", "sem", "que", "qual", "quais", "como", "quando", "onde", "uma", "um"
  ]);

  const tokens = normalize(question)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopwords.has(token));

  return [...new Set(tokens)].slice(0, 8);
}

function buildInsufficientContext(): string {
  return [
    "Resolver Juridico: base insuficiente para conclusao numerica/juridica fechada.",
    "Instrucoes de seguranca:",
    "- Nao concluir sem ato normativo especifico confirmado.",
    "- Declarar: 'Nao existe previsao legal expressa.' quando aplicavel.",
    "- Declarar: 'Ha divergencia interpretativa.' quando houver conflito de entendimento.",
    "- Declarar: 'O entendimento pode variar conforme fiscalizacao.' quando depender de pratica administrativa.",
    "- Solicitar dados minimos: categoria, UF, finalidade e periodo de vigencia da regra consultada."
  ].join("\n");
}

function buildGroundedContext(norms: LegalNormRow[], articles: LegalArticleRow[], interpretations: LegalInterpretationRow[]): string {
  const normsBlock = norms
    .slice(0, 6)
    .map((norm) => {
      const numberPart = norm.norm_number ? ` ${norm.norm_number}/${norm.norm_year || ""}`.trim() : "";
      return `- ${norm.norm_type.toUpperCase()}${numberPart ? ` ${numberPart}` : ""} | ${norm.title} | orgao: ${norm.issuing_body} | status: ${norm.status} | fonte: ${norm.official_url}`;
    })
    .join("\n");

  const articlesBlock = articles
    .slice(0, 8)
    .map((article) => {
      const trimmed = article.article_text.length > 420 ? `${article.article_text.slice(0, 420)}...` : article.article_text;
      return `- ${article.article_label} (norm_id: ${article.norm_id}) => ${trimmed}`;
    })
    .join("\n");

  const interpBlock = interpretations
    .slice(0, 5)
    .map((item) => {
      const act = [item.act_type, item.act_number].filter(Boolean).join(" ");
      const trimmed = item.interpretation_text.length > 260 ? `${item.interpretation_text.slice(0, 260)}...` : item.interpretation_text;
      return `- ${item.title} | ${act} | orgao: ${item.issuing_body} | fonte: ${item.official_url} | trecho: ${trimmed}`;
    })
    .join("\n");

  return [
    "Resolver Juridico: fundamentos verificados em base oficial cadastrada.",
    "Normas encontradas:",
    normsBlock || "- nenhuma norma encontrada",
    "Artigos encontrados:",
    articlesBlock || "- nenhum artigo encontrado",
    "Entendimentos administrativos encontrados:",
    interpBlock || "- nenhum entendimento administrativo encontrado",
    "Regra: se faltar artigo/norma para ponto conclusivo, responder sem conclusao fechada e pedir dados adicionais."
  ].join("\n");
}

export async function resolveLegalGrounding(question: string): Promise<LegalResolution> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      status: "unavailable",
      context: "Resolver Juridico indisponivel: banco de base legal nao conectado.",
      matchedNorms: 0
    };
  }

  const tokens = tokenize(question);
  if (tokens.length === 0) {
    return {
      status: "insufficient",
      context: buildInsufficientContext(),
      matchedNorms: 0
    };
  }

  let articleRows: LegalArticleRow[] = [];
  for (const token of tokens) {
    const { data } = await supabase
      .from("legal_articles")
      .select("id,norm_id,article_label,article_text")
      .ilike("article_text", `%${token}%`)
      .limit(12);

    if (data?.length) {
      articleRows = [...articleRows, ...(data as LegalArticleRow[])];
    }
    if (articleRows.length >= 20) {
      break;
    }
  }

  const normIds = [...new Set(articleRows.map((row) => row.norm_id))].slice(0, 20);

  let normRows: LegalNormRow[] = [];
  if (normIds.length > 0) {
    const { data } = await supabase
      .from("legal_norms")
      .select("id,norm_type,norm_number,norm_year,title,issuing_body,status,official_url")
      .in("id", normIds)
      .eq("status", "vigente")
      .limit(20);
    normRows = (data as LegalNormRow[]) || [];
  }

  let interpretationRows: LegalInterpretationRow[] = [];
  for (const token of tokens.slice(0, 4)) {
    const { data } = await supabase
      .from("legal_admin_interpretations")
      .select("id,title,issuing_body,act_type,act_number,interpretation_text,official_url")
      .ilike("interpretation_text", `%${token}%`)
      .limit(6);
    if (data?.length) {
      interpretationRows = [...interpretationRows, ...(data as LegalInterpretationRow[])];
    }
    if (interpretationRows.length >= 10) {
      break;
    }
  }

  if (normRows.length === 0 || articleRows.length === 0) {
    return {
      status: "insufficient",
      context: buildInsufficientContext(),
      matchedNorms: normRows.length
    };
  }

  const filteredArticles = articleRows.filter((article) => normRows.some((norm) => norm.id === article.norm_id));

  return {
    status: "grounded",
    context: buildGroundedContext(normRows, filteredArticles, interpretationRows),
    matchedNorms: normRows.length
  };
}
