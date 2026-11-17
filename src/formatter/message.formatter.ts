import { formatBrlPrice } from '../collector/parser.js';
import type { AffiliateOffer } from '../types/offer.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Monta a legenda persuasiva para WhatsApp com gatilho de desconto,
 * preço original riscado, preço atual em destaque e link de afiliado.
 */
export function buildOfferCaption(offer: AffiliateOffer): string {
  const lines: string[] = [
    `🔥 *OFERTA COM ${offer.discountPercent}% OFF!*`,
    '',
    `📦 *${offer.title}*`,
    '',
  ];

  if (offer.originalPrice > offer.currentPrice) {
    lines.push(`❌ De: ~${formatBrlPrice(offer.originalPrice)}~`);
  }

  lines.push(`✅ Por: *${formatBrlPrice(offer.currentPrice)}*`);
  lines.push('');
  lines.push(`🛒 *Compre aqui:* ${offer.affiliateUrl}`);

  return lines.join('\n');
}

/**
 * Faz o download da imagem do produto em alta resolução para envio como mídia nativa.
 */
export async function downloadOfferImage(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl, {
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar imagem (${response.status}): ${imageUrl}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Tipo de mídia inesperado (${contentType}) em ${imageUrl}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Tamanho de imagem inválido (${arrayBuffer.byteLength} bytes)`);
  }

  return Buffer.from(arrayBuffer);
}
