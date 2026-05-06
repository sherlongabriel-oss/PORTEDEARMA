function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isLegalResponseComplete(response: string): boolean {
  const lower = normalize(response);

  const hasLegalBasis =
    lower.includes("lei") ||
    lower.includes("art") ||
    lower.includes("decreto") ||
    lower.includes("portaria") ||
    lower.includes("instrucao normativa") ||
    lower.includes("instrução normativa");

  const hasPracticalAction =
    lower.includes("voce deve") ||
    lower.includes("deve") ||
    lower.includes("proximo passo") ||
    lower.includes("na pratica") ||
    lower.includes("procedimento");

  const hasRisk =
    lower.includes("risco") ||
    lower.includes("autuacao") ||
    lower.includes("apreensao") ||
    lower.includes("responsabilizacao") ||
    lower.includes("responsabilização") ||
    lower.includes("penal");

  return hasLegalBasis && hasPracticalAction && hasRisk;
}

export function buildQualityRepairPrompt(question: string, previous: string): string {
  return [
    `Pergunta original: ${question}`,
    "Resposta anterior insuficiente (muito genérica ou incompleta):",
    previous,
    "Reescreva de forma direta, objetiva e completa.",
    "Obrigatorio: incluir base legal verificavel, aplicacao pratica imediata, risco juridico real e proximo passo acionavel.",
    "Nao use cabecalhos, nao use markdown, nao floreie."
  ].join("\n");
}
