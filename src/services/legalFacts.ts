function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isMinAgePossessionQuestion(text: string): boolean {
  const lower = normalize(text);
  const asksAge =
    lower.includes("idade minima") ||
    lower.includes("idade") ||
    lower.includes("quantos anos") ||
    lower.includes("idade para") ||
    lower.includes("anos para");
  const asksPossession =
    lower.includes("posse") ||
    lower.includes("possuir arma") ||
    lower.includes("ter arma") ||
    lower.includes("comprar arma") ||
    lower.includes("comprar uma arma") ||
    lower.includes("compra de arma") ||
    lower.includes("adquirir arma");
  return asksAge && asksPossession;
}

function isHowToGetCarryQuestion(text: string): boolean {
  const lower = normalize(text);
  const asksHow =
    lower.includes("como tirar") ||
    lower.includes("como obter") ||
    lower.includes("como conseguir") ||
    lower.includes("como solicitar") ||
    lower.includes("quero tirar");
  const hasCarry = lower.includes("porte") && lower.includes("arma");
  return asksHow && hasCarry;
}

function isShootingTestCostQuestion(text: string): boolean {
  const lower = normalize(text);
  const asksCost =
    lower.includes("quanto custa") ||
    lower.includes("qual o valor") ||
    lower.includes("preco") ||
    lower.includes("preço") ||
    lower.includes("valor");
  const hasExam =
    (lower.includes("exame") || lower.includes("teste") || lower.includes("avaliacao") || lower.includes("avaliação")) &&
    (lower.includes("tiro") || lower.includes("capacidade tecnica") || lower.includes("capacidade técnica"));
  return asksCost && hasExam;
}

function isCacHowManyGunsQuestion(text: string): boolean {
  const lower = normalize(text);
  const asksQuantity =
    lower.includes("quantas armas") ||
    lower.includes("quantidade de armas") ||
    lower.includes("limite de armas") ||
    lower.includes("pode ter");
  const hasCac =
    lower.includes("cac") ||
    lower.includes("atirador") ||
    lower.includes("cacador") ||
    lower.includes("caçador") ||
    lower.includes("colecionador");
  return asksQuantity && hasCac;
}

export function resolveCriticalLegalFact(question: string): string | null {
  if (isCacHowManyGunsQuestion(question)) {
    return [
      "Para CAC, os limites variam por categoria e nivel de atirador, nao existe um numero unico para todos.",
      "Atirador nivel 1: ate 4 armas de uso permitido; nivel 2: ate 8 de uso permitido; nivel 3: ate 16 armas, sendo ate 4 de calibre restrito e as demais de calibre permitido.",
      "Cacador (CAS): ate 6 armas, com limite de ate 2 de calibre restrito.",
      "Colecionador: acervo por criterios de colecao, com controle por modelo/tipo/variante/calibre/procedencia, conforme regras vigentes do sistema militar.",
      "Base normativa a conferir na redacao consolidada vigente: Decreto 11.615/2023 e Portaria Conjunta C Ex/DG-PF 2/2023, com alteracoes posteriores aplicaveis (incluindo atos conjuntos supervenientes).",
      "Atencao: progressao de nivel e limites dependem de requisitos de habitualidade e demais condicionantes administrativos em vigor."
    ].join(" ");
  }

  if (isHowToGetCarryQuestion(question)) {
    return [
      "No Brasil, porte de arma para particular e excepcional: a regra geral e proibicao de porte, salvo hipoteses legais e autorizacao especifica.",
      "Base legal objetiva: Lei 10.826/2003, art. 6o (hipoteses de excecao e porte funcional) e art. 10 (porte por autorizacao da Policia Federal para casos permitidos).",
      "Fluxo pratico correto: primeiro definir se o caso e porte funcional (categoria prevista em lei) ou porte por autorizacao individual; depois reunir requisitos legais e documentais, protocolar no orgao competente e aguardar decisao administrativa fundamentada.",
      "Risco juridico: portar arma sem amparo legal valido pode gerar prisao em flagrante, apreensao da arma e responsabilizacao penal. Se quiser, eu te digo o fluxo exato para sua categoria e UF sem generalizar."
    ].join(" ");
  }

  if (isShootingTestCostQuestion(question)) {
    return [
      "Nao existe, na Lei 10.826/2003, um preco unico nacional fixado para exame de tiro/capacidade tecnica.",
      "Em regra, o valor e de mercado e varia por UF, profissional credenciado e estrutura do local de avaliacao; por isso qualquer numero fechado sem cidade e credenciado seria impreciso.",
      "Passo pratico objetivo: cote com pelo menos 3 profissionais/entidades habilitadas na sua UF, confirme se o documento emitido atende ao processo administrativo aplicavel e guarde comprovantes para instrucao do pedido.",
      "Se voce me disser sua cidade/UF, eu monto um checklist exato de cotacao e validacao documental para evitar gasto inutil e indeferimento."
    ].join(" ");
  }

  if (isMinAgePossessionQuestion(question)) {
    return [
      "Para posse/aquisicao civil comum de arma de fogo, a idade minima legal e 25 anos.",
      "Base legal: Lei 10.826/2003, art. 4o, inciso I; orgao administrativo competente no caso civil: Policia Federal (SINARM).",
      "Informar 21 anos para posse civil comum esta incorreto e pode causar indeferimento administrativo e erro juridico relevante.",
      "Se seu caso for categoria funcional com regime proprio, me diga qual para eu aplicar a regra especifica sem generalizar."
    ].join(" ");
  }

  return null;
}
