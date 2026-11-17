/**
 * Funções puras de parsing e normalização para anúncios do Mercado Livre.
 */

const BRL_CURRENCY_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatBrlPrice(value: number): string {
  return BRL_CURRENCY_FORMATTER.format(value);
}

/**
 * Converte textos monetários em português/BRL (ex: "R$ 1.299,90", "299,90", "1.200")
 * para número em ponto flutuante.
 */
export function parseBrlPrice(raw: string | null | undefined): number | null {
  if (!raw) return null;

  const cleaned = raw
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^\d.,]/g, '');

  if (!cleaned) return null;

  // Caso padrão brasileiro com vírgula decimal: "1.299,90" ou "299,90"
  if (cleaned.includes(',')) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  // Caso com separador de milhar sem centavos: "1.299"
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    const parsed = Number.parseFloat(cleaned.replace(/\./g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Extrai e normaliza o ID do anúncio no padrão "MLB1234567890".
 */
export function extractMlbId(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input.toUpperCase().match(/MLB-?(\d{6,14})/);
  if (!match || !match[1]) return null;
  return `MLB${match[1]}`;
}

/**
 * Remove parâmetros de rastreamento e fragmentos da URL do Mercado Livre,
 * preservando apenas a URL canônica limpa do produto.
 */
export function cleanMercadoLivreUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Remove hash (#polycard_client=..., etc.) e todas as query strings de tracking
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString();
  } catch {
    return rawUrl.split('#')[0]?.split('?')[0] ?? rawUrl;
  }
}

/**
 * Tenta elevar a resolução de imagens do CDN mlstatic.com (ex: -I.jpg, -V.webp -> -O.jpg)
 * para enviar mídia nítida no WhatsApp.
 */
export function upgradeImageResolution(imageUrl: string): string {
  if (!imageUrl) return imageUrl;

  if (imageUrl.includes('mlstatic.com')) {
    return imageUrl.replace(/-[A-Z](\.(?:jpg|jpeg|png|webp))(\?.*)?$/i, '-O$1');
  }

  return imageUrl;
}

/**
 * Calcula ou valida o percentual de desconto (0 a 99).
 */
export function calculateDiscountPercent(
  originalPrice: number,
  currentPrice: number,
  scrapedPercent?: number | null,
): number {
  if (originalPrice > currentPrice && originalPrice > 0) {
    const computed = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
    return Math.max(0, Math.min(99, computed));
  }

  if (typeof scrapedPercent === 'number' && Number.isFinite(scrapedPercent)) {
    return Math.max(0, Math.min(99, Math.round(scrapedPercent)));
  }

  return 0;
}
