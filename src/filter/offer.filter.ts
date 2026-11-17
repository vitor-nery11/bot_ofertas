import type { OfferDatabase } from '../db/database.js';
import type { RawOffer } from '../types/offer.js';
import { logger } from '../utils/logger.js';

export interface FilterConfig {
  minDiscountPercent: number;
  dedupWindowHours: number;
}

export interface FilterResult {
  approved: RawOffer[];
  discardedByDiscount: number;
  discardedByDuplicate: number;
}

/**
 * Filtra ofertas por desconto mínimo, deduplica dentro do mesmo lote
 * (mantendo o menor preço por MLB) e consulta o histórico no SQLite.
 */
export function filterAndDeduplicateOffers(
  rawOffers: RawOffer[],
  db: OfferDatabase,
  config: FilterConfig,
): FilterResult {
  // Deduplica no próprio lote mantendo a variação de menor preço para cada MLB
  const uniqueByMlb = new Map<string, RawOffer>();
  for (const offer of rawOffers) {
    const existing = uniqueByMlb.get(offer.mlbId);
    if (!existing || offer.currentPrice < existing.currentPrice) {
      uniqueByMlb.set(offer.mlbId, offer);
    }
  }

  const approved: RawOffer[] = [];
  let discardedByDiscount = 0;
  let discardedByDuplicate = 0;

  for (const offer of uniqueByMlb.values()) {
    if (offer.discountPercent < config.minDiscountPercent) {
      discardedByDiscount++;
      continue;
    }

    const isDup = db.shouldIgnoreAsDuplicate(
      offer.mlbId,
      offer.currentPrice,
      config.dedupWindowHours,
    );

    if (isDup) {
      discardedByDuplicate++;
      logger.debug(
        { mlbId: offer.mlbId, currentPrice: offer.currentPrice },
        'Oferta ignorada pela deduplicação temporal',
      );
      continue;
    }

    approved.push(offer);
  }

  return {
    approved,
    discardedByDiscount,
    discardedByDuplicate,
  };
}
