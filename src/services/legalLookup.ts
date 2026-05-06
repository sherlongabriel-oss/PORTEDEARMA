const ESTATUTO_URL = "https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm";

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export async function verifyMinAgeForPossessionOnline(): Promise<{
  confirmed: boolean;
  sourceUrl: string;
}> {
  try {
    const response = await fetch(ESTATUTO_URL, { method: "GET" });
    if (!response.ok) {
      return { confirmed: false, sourceUrl: ESTATUTO_URL };
    }

    const html = await response.text();
    const lower = normalize(html);
    const hasArticle4 = lower.includes("art. 4") || lower.includes("art 4");
    const hasTwentyFive =
      lower.includes("vinte e cinco anos") ||
      lower.includes("25 (vinte e cinco) anos") ||
      lower.includes("25 anos");

    return {
      confirmed: hasArticle4 && hasTwentyFive,
      sourceUrl: ESTATUTO_URL
    };
  } catch {
    return { confirmed: false, sourceUrl: ESTATUTO_URL };
  }
}
