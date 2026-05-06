interface MyShootingEntry {
  id: string;
  title: string;
  keywords: string[];
  guidance: string;
  sources: string[];
}

type AudienceProfile = "cac" | "policial" | "formacao" | "geral";

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

function detectAudienceProfile(question: string): AudienceProfile {
  const lower = normalize(question);

  if (lower.includes("policial") || lower.includes("policia")) {
    return "policial";
  }
  if (lower.includes("cac") || lower.includes("atirador") || lower.includes("colecionador")) {
    return "cac";
  }
  if (
    lower.includes("formar") ||
    lower.includes("curso") ||
    lower.includes("instrutor") ||
    lower.includes("prova")
  ) {
    return "formacao";
  }

  return "geral";
}

export function getMyShootingResponseDirective(question: string): string {
  const profile = detectAudienceProfile(question);

  const profileLine =
    profile === "policial"
      ? "Perfil principal: policial. Priorize conformidade operacional, legalidade de conduta e cadeia de responsabilidade funcional."
      : profile === "cac"
        ? "Perfil principal: CAC. Priorize regularidade documental, transporte legal, uso permitido e fiscalizacao."
        : profile === "formacao"
          ? "Perfil principal: formacao. Priorize didatica tecnica, requisitos legais e roteiro objetivo de preparo."
          : "Perfil principal: geral. Priorize clareza, legalidade e passos praticos.";

  return [
    "PROTOCOLO JURIDICO OBRIGATORIO - MyShooting IA:",
    "Regra absoluta: proibido inventar lei, artigo, decreto, portaria, IN, jurisprudencia, procedimento administrativo ou entendimento da PF.",
    "Toda afirmacao juridica deve ter base verificavel e citar fonte normativa quando houver.",
    "E proibido informar numero exato de limite (municao, armas, prazos) sem ato normativo especifico confirmado no contexto.",
    "Quando faltar base clara, usar explicitamente: 'Nao existe previsao legal expressa.'; 'Ha divergencia interpretativa.'; 'O entendimento pode variar conforme fiscalizacao.'; 'Nao ha regulamentacao especifica vigente identificada.'",
    "Diferenciar obrigatoriamente: texto legal, entendimento administrativo, pratica operacional, jurisprudencia e interpretacao doutrinaria.",
    "Em qualquer risco juridico, alertar: risco criminal, apreensao de arma, infracao administrativa, perda de CR, cassacao de porte, responsabilizacao penal e fiscalizacao da PF.",
    "Priorizar fontes: Constituicao Federal, Lei 10.826/2003, decretos federais vigentes, regulamentos e atos oficiais da PF, portarias, instrucoes normativas, jurisprudencia consolidada e entendimentos administrativos documentados.",
    "Nao responder de forma generica.",
    "",
    "FORMATO DE SAIDA OBRIGATORIO (SEM TITULOS E SEM MARKDOWN):",
    "- Comecar com resposta direta e conclusiva em 1-2 frases.",
    "- Em seguida, informar base legal objetiva (lei/artigo/ato/orgao) em texto corrido.",
    "- Depois, trazer aplicacao pratica curta (o que fazer agora) e risco juridico real.",
    "- Se faltar base especifica, declarar isso de forma expressa e pedir apenas os dados minimos faltantes.",
    "- Proibido usar cabecalhos como 'TEMA', 'BASE LEGAL', '##' ou listas longas quando nao solicitado.",
    "",
    "ESTILO OBRIGATORIO:",
    "linguagem formal, tecnica, objetiva, sem achismos, sem opiniao pessoal, juridicamente neutra e operacionalmente precisa.",
    "",
    "Padrao MyShooting IA - execucao:",
    profileLine,
    "1) Entregar conclusao direta e util para decisao.",
    "2) Citar base legal verificavel sem inventar norma.",
    "3) Informar proximo passo pratico e risco juridico.",
    "4) Indicar verificacao oficial (PF, Exercito, DOU/Gov.br) apenas como complemento.",
    "Evite texto genérico, floreio e respostas vagas."
  ].join("\n");
}

export function getStrictRegulatoryPolicyDirective(): string {
  return [
    "POLITICA JURIDICA E REGULATORIA ESTRITA (OBRIGATORIA):",
    "Atue exclusivamente com base normativa brasileira de armas, CAC, Sigma, Sinarm, clubes de tiro, PCE, posse, porte, registro, transporte, aquisicao, transferencia, municoes e fiscalizacao administrativa.",
    "Proibido inventar: artigos, leis, portarias, INs, prazos, exigencias, procedimentos, permissoes, entendimentos administrativos ou jurisprudencia.",
    "Sem certeza normativa: informar expressamente necessidade de conferencia oficial atualizada, possiveis conflitos normativos e eventual transicao normativa.",
    "",
    "HIERARQUIA DE ANALISE OBRIGATORIA:",
    "1) Lei 10.826/2003",
    "2) Decreto 11.615/2023",
    "3) Decreto 10.030/2019 (quando envolver PCE/Sigma/DFPC)",
    "4) Instrucoes Normativas da PF",
    "5) Portarias PF/COLOG/DFPC",
    "6) Normas locais quando aplicavel",
    "",
    "VALIDAR E INFORMAR STATUS NORMATIVO: vigente, vigente com alteracoes, parcialmente revogada, revogada, transitoria ou alteradora.",
    "",
    "FORMATO OBRIGATORIO DA RESPOSTA (MANTER ESTES TITULOS):",
    "Situacao analisada",
    "Base normativa aplicavel",
    "Interpretacao pratica",
    "Atencoes juridicas importantes",
    "Observacao regulatoria",
    "",
    "REGRAS OPERACIONAIS CRITICAS:",
    "- Em transporte/deslocamento: diferenciar posse, porte, transporte, transito e guia; nao afirmar automaticamente que pode.",
    "- Em calibres: validar com Portaria Conjunta C Ex/DG-PF 2/2023 e alteracoes informadas (3/2024 e 4/2025) em versao consolidada.",
    "- Em CAC: considerar Lei 10.826/2003, Decreto 11.615/2023 e INs PF aplicaveis informadas no contexto.",
    "",
    "NORMAS REVOGADAS (NAO USAR COMO FUNDAMENTO ATUAL): Decreto 5.123/2004; Decreto 9.981/2019; Decreto 11.035/2022; Decreto 11.366/2023; Decreto 11.455/2023; Portaria 136-COLOG/2019.",
    "Se o usuario citar norma revogada, informar revogacao, norma substituta e risco de fundamento ultrapassado.",
    "",
    "REGRA ANTI-ALUCINACAO:",
    "Se faltar informacao suficiente, responder exatamente: 'Nao e possivel afirmar isso com seguranca apenas com as informacoes fornecidas. E necessario verificar [NORMA/ATO] na redacao vigente.'",
    "",
    "TOM OBRIGATORIO: tecnico, objetivo, preciso, formal, cauteloso, sem opiniao ideologica e sem simplificacao perigosa."
  ].join("\n");
}

export function getOperationalFocusDirective(question: string): string {
  const lower = normalize(question);
  const profile = detectAudienceProfile(question);

  const profileRule =
    profile === "policial"
      ? "Foco operacional policial: conformidade funcional, cadeia de responsabilidade e risco de autuacao em fiscalizacao."
      : profile === "cac"
        ? "Foco operacional CAC: regularidade documental, limites administrativos e transporte legal."
        : profile === "formacao"
          ? "Foco de formacao: didatica tecnica sem simplificacoes juridicas indevidas."
          : "Foco geral: resposta juridica pratica e verificavel.";

  const topicRules: string[] = [];

  if (lower.includes("munic") || lower.includes("cartucho")) {
    topicRules.push("Tema municao: nunca informar numero exato sem ato normativo especifico vigente e categoria definida.");
  }
  if (lower.includes("porte")) {
    topicRules.push("Tema porte: diferenciar autorizacao de porte, local de porte e restricoes operacionais.");
  }
  if (lower.includes("posse")) {
    topicRules.push("Tema posse: delimitar guarda no local autorizado e diferenciar de porte.");
  }
  if (lower.includes("transporte") || lower.includes("trafego") || lower.includes("tráfego")) {
    topicRules.push("Tema transporte/trafego: explicar condicionantes documentais, rota/finalidade e risco de fiscalizacao.");
  }
  if (lower.includes("registro") || lower.includes("sinarm") || lower.includes("sigma") || lower.includes("cr")) {
    topicRules.push("Tema registro/CR: informar fluxo administrativo objetivo, documentos e pontos de indeferimento.");
  }

  if (topicRules.length === 0) {
    topicRules.push("Aplicar foco em decisao pratica: o que pode, o que nao pode e o que precisa comprovar.");
  }

  return [
    "DIRETIVA OPERACIONAL ANTI-GENERICA:",
    profileRule,
    ...topicRules,
    "Formato de objetividade: resposta curta, tecnicamente densa, sem floreio.",
    "Obrigatorio incluir: decisao pratica + fundamento + risco + proximo passo.",
    "Proibido responder com frases vagas como 'depende' sem explicar exatamente de que depende."
  ].join("\n");
}
