interface MyShootingEntry {
  id: string;
  title: string;
  keywords: string[];
  guidance: string;
  sources: string[];
}

const ENTRIES: MyShootingEntry[] = [
  {
    id: "base-legal",
    title: "Base legal de armas no Brasil",
    keywords: ["legislacao", "lei", "armas", "estatuto", "desarmamento", "decreto"],
    guidance:
      "A resposta deve considerar o Estatuto do Desarmamento (Lei 10.826/2003) e regulamentacoes federais vigentes. Em caso de alteracao recente, orientar confirmacao em fonte oficial.",
    sources: ["Lei 10.826/2003", "Diario Oficial da Uniao", "Portal Gov.br (PF e Exercito)"]
  },
  {
    id: "porte-posse",
    title: "Diferenca entre posse e porte",
    keywords: ["porte", "posse", "arma em casa", "transporte"],
    guidance:
      "Explicar diferenca juridica entre posse e porte, limites de local, e necessidade de autorizacao especifica conforme norma vigente.",
    sources: ["Lei 10.826/2003", "Normas da Policia Federal"]
  },
  {
    id: "cac",
    title: "Regras para CAC",
    keywords: ["cac", "colecionador", "atirador", "caca", "cr"],
    guidance:
      "Explicar requisitos de regularidade, documentos e condicionantes de transporte/uso conforme normativos do Exercito e regras federais vigentes.",
    sources: ["Normas do Comando do Exercito", "Diario Oficial da Uniao"]
  },
  {
    id: "registro",
    title: "Registro e regularizacao",
    keywords: ["registro", "sinarm", "sigma", "regularizar", "renovacao"],
    guidance:
      "Orientar sobre registro, renovacao e documentacao oficial. Se faltar dado do caso concreto, solicitar UF, situacao e tipo de arma.",
    sources: ["Policia Federal", "Exercito Brasileiro", "Gov.br"]
  },
  {
    id: "crime",
    title: "Risco penal e conduta segura",
    keywords: ["crime", "ilegal", "prisao", "pena", "irregular"],
    guidance:
      "Nao instruir pratica ilegal. Explicar riscos juridicos de forma preventiva e recomendar consulta a advogado para caso individual.",
    sources: ["Codigo Penal", "Lei 10.826/2003"]
  }
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isArmsLegalTopic(question: string): boolean {
  const lower = normalize(question);
  return [
    "arma",
    "armas",
    "porte",
    "posse",
    "cac",
    "registro",
    "sinarm",
    "sigma",
    "desarmamento",
    "decreto",
    "lei"
  ].some((term) => lower.includes(term));
}

export function getMyShootingContext(question: string): {
  context: string;
  confidence: "high" | "medium" | "low";
  matchedTopics: string[];
} {
  const lower = normalize(question);

  const scored = ENTRIES.map((entry) => {
    const hits = entry.keywords.filter((keyword) => lower.includes(normalize(keyword))).length;
    return { entry, hits };
  }).filter((result) => result.hits > 0);

  if (scored.length === 0) {
    return {
      context: "",
      confidence: "low",
      matchedTopics: []
    };
  }

  const top = scored.sort((a, b) => b.hits - a.hits).slice(0, 3);
  const maxHits = top[0]?.hits ?? 0;
  const confidence: "high" | "medium" | "low" = maxHits >= 3 ? "high" : maxHits === 2 ? "medium" : "low";

  const blocks = top.map(({ entry }) => {
    return [
      `Tema: ${entry.title}`,
      `Guia: ${entry.guidance}`,
      `Fontes de referencia: ${entry.sources.join("; ")}`
    ].join("\n");
  });

  return {
    context: blocks.join("\n\n"),
    confidence,
    matchedTopics: top.map(({ entry }) => entry.title)
  };
}
