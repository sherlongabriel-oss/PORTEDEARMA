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
    lower.includes("idade para");
  const asksPossession =
    lower.includes("posse") ||
    lower.includes("possuir arma") ||
    lower.includes("ter arma") ||
    lower.includes("compra de arma") ||
    lower.includes("adquirir arma");
  return asksAge && asksPossession;
}

export function resolveCriticalLegalFact(question: string): string | null {
  if (isMinAgePossessionQuestion(question)) {
    return [
      "TEMA\nIdade minima para aquisicao/posse civil de arma de fogo.",
      "COMO FUNCIONA NA PRATICA\nNa regra geral para cidadao civil, a exigencia legal e idade minima de 25 anos para aquisicao de arma de fogo.",
      "PASSO A PASSO\n1) Confirmar que o caso e de posse/aquisicao civil comum.\n2) Verificar requisito de idade minima de 25 anos.\n3) Cumprir os demais requisitos legais e administrativos.",
      "BASE LEGAL CONFIRMADA\nLei: Lei 10.826/2003.\nArtigo: Art. 4o, inciso I.\nOrgao responsavel: Policia Federal (registro no SINARM, no caso civil).",
      "NIVEL DE SEGURANCA DA INFORMACAO\nConfirmado em lei.",
      "ALERTAS IMPORTANTES\nInformar idade inferior (ex.: 21) para posse civil comum esta incorreto para a regra geral e pode induzir erro juridico-administrativo.",
      "LIMITACAO DA RESPOSTA\nPodem existir regimes especificos para categorias funcionais/profissionais com normativas proprias; para posse civil comum, a referencia acima e a base legal geral."
    ].join("\n\n");
  }

  return null;
}
