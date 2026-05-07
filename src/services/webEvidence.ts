import { config } from "../config.js";
import { logger } from "../utils/logger.js";

type EvidenceStatus = "grounded" | "insufficient" | "unavailable";

interface GoogleSearchItem {
  title?: string;
  link?: string;
  snippet?: string;
}

interface GoogleSearchResponse {
  items?: GoogleSearchItem[];
}

export interface EvidenceSource {
  title: string;
  link: string;
  snippet: string;
  domain: string;
}

export interface WebEvidenceResult {
  status: EvidenceStatus;
  context: string;
  sources: EvidenceSource[];
}

function hostnameOf(urlText: string): string {
  try {
    return new URL(urlText).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedDomain(hostname: string, allowedDomains: string[]): boolean {
  if (!hostname) {
    return false;
  }

  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function buildUnavailableContext(): string {
  return [
    "Verificador de evidencias web indisponivel.",
    "Nao afirmar noticia ou mudanca regulatoria atual sem fonte verificavel.",
    "Se necessario, pedir ao usuario mais contexto e orientar consulta em fonte oficial."
  ].join("\n");
}

function buildInsufficientContext(): string {
  return [
    "Verificador de evidencias web sem convergencia suficiente.",
    "Regra: nao fechar afirmacao factual forte sobre noticias sem ao menos 2 fontes confiaveis.",
    "Se nao houver convergencia, responder com limite de confianca e listar o que falta confirmar."
  ].join("\n");
}

function buildGroundedContext(sources: EvidenceSource[]): string {
  const lines = sources
    .slice(0, 5)
    .map((item, index) => `${index + 1}) ${item.title} | ${item.domain} | ${item.link} | trecho: ${item.snippet}`)
    .join("\n");

  return [
    "Verificador de evidencias web com fontes convergentes.",
    "Use somente os fatos sustentados pelas fontes abaixo.",
    "Ao responder, cite explicitamente os links utilizados.",
    lines
  ].join("\n");
}

export async function resolveWebEvidence(question: string): Promise<WebEvidenceResult> {
  if (!config.newsSearchEnabled) {
    return {
      status: "unavailable",
      context: buildUnavailableContext(),
      sources: []
    };
  }

  if (!config.googleApiKey || !config.googleCseId) {
    return {
      status: "unavailable",
      context: buildUnavailableContext(),
      sources: []
    };
  }

  const allowedDomains = config.newsAllowedDomains;
  if (allowedDomains.length === 0) {
    return {
      status: "unavailable",
      context: "NEWS_ALLOWED_DOMAINS nao configurado. Defina dominios confiaveis para habilitar validacao externa.",
      sources: []
    };
  }

  const query = `${question} Brasil`;
  const endpoint = new URL("https://www.googleapis.com/customsearch/v1");
  endpoint.searchParams.set("key", config.googleApiKey);
  endpoint.searchParams.set("cx", config.googleCseId);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("hl", "pt-BR");
  endpoint.searchParams.set("gl", "br");
  endpoint.searchParams.set("num", "8");
  endpoint.searchParams.set("dateRestrict", "m12");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      logger.warn({ status: response.status }, "Falha ao consultar Google Custom Search");
      return {
        status: "unavailable",
        context: buildUnavailableContext(),
        sources: []
      };
    }

    const payload = (await response.json()) as GoogleSearchResponse;
    const rawItems = payload.items || [];

    const normalized = rawItems
      .map((item) => {
        const link = item.link || "";
        const domain = hostnameOf(link);
        return {
          title: (item.title || "Sem titulo").trim(),
          link,
          snippet: (item.snippet || "Sem trecho disponivel").replace(/\s+/g, " ").trim(),
          domain
        };
      })
      .filter((item) => item.link && item.domain && isAllowedDomain(item.domain, allowedDomains));

    const dedupedByDomain = new Map<string, EvidenceSource>();
    for (const item of normalized) {
      if (!dedupedByDomain.has(item.domain)) {
        dedupedByDomain.set(item.domain, item);
      }
    }

    const sources = [...dedupedByDomain.values()].slice(0, 5);

    if (sources.length < 2) {
      return {
        status: "insufficient",
        context: buildInsufficientContext(),
        sources
      };
    }

    return {
      status: "grounded",
      context: buildGroundedContext(sources),
      sources
    };
  } catch (error) {
    logger.warn({ error }, "Erro ao obter evidencias web");
    return {
      status: "unavailable",
      context: buildUnavailableContext(),
      sources: []
    };
  }
}
