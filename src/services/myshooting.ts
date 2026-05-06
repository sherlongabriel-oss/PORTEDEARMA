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
    "ESTRUTURA OBRIGATORIA DA RESPOSTA:",
    "TEMA",
    "COMO FUNCIONA NA PRATICA",
    "PASSO A PASSO (etapas numeradas)",
    "BASE LEGAL CONFIRMADA (formato: Lei; Decreto; Portaria; Artigo; Orgao responsavel)",
    "NIVEL DE SEGURANCA DA INFORMACAO (Confirmado em lei; Regulamentacao administrativa; Entendimento predominante; Tema controverso; Sem previsao expressa)",
    "DIFERENCAS ENTRE CATEGORIAS (quando aplicavel: CAC, PF, PC, PM, Penal, GM, Colecionador, Cacador, Atirador)",
    "ALERTAS IMPORTANTES",
    "LIMITACAO DA RESPOSTA",
    "",
    "ESTILO OBRIGATORIO:",
    "linguagem formal, tecnica, objetiva, sem achismos, sem opiniao pessoal, juridicamente neutra e operacionalmente precisa.",
    "",
    "Padrao MyShooting IA - formato obrigatorio de resposta:",
    profileLine,
    "1) Resposta Direta: comece com a conclusao pratica em 1-2 frases.",
    "2) Base Legal: cite apenas normas que voce tenha base no contexto; se nao tiver, diga que falta base especifica.",
    "3) Aplicacao Pratica: descreva o que fazer agora em passos curtos.",
    "4) Limites e Risco: destaque o que nao pode ser feito e o risco juridico.",
    "5) Verificacao Oficial: indicar onde confirmar (PF, Exercito, DOU/Gov.br).",
    "Evite texto genérico, floreio e respostas vagas."
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
