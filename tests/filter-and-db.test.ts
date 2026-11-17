import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OfferDatabase } from '../src/db/database.js';
import { filterAndDeduplicateOffers } from '../src/filter/offer.filter.js';
import type { RawOffer } from '../src/types/offer.js';

function makeOffer(overrides: Partial<RawOffer> = {}): RawOffer {
  return {
    mlbId: 'MLB123456789',
    title: 'Fone Bluetooth Exemplo',
    originalPrice: 200,
    currentPrice: 140,
    discountPercent: 30,
    cleanUrl: 'https://produto.mercadolivre.com.br/MLB-123456789-fone',
    imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_123-O.jpg',
    sourceUrl: 'https://www.mercadolivre.com.br/ofertas',
    ...overrides,
  };
}

describe('OfferDatabase & filterAndDeduplicateOffers', () => {
  let db: OfferDatabase;

  beforeEach(() => {
    db = new OfferDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('discards offers below minimum discount threshold', () => {
    const offers = [
      makeOffer({ mlbId: 'MLB1', discountPercent: 19 }),
      makeOffer({ mlbId: 'MLB2', discountPercent: 20 }),
      makeOffer({ mlbId: 'MLB3', discountPercent: 35 }),
    ];

    const result = filterAndDeduplicateOffers(offers, db, {
      minDiscountPercent: 20,
      dedupWindowHours: 24,
    });

    expect(result.discardedByDiscount).toBe(1);
    expect(result.approved.map((o) => o.mlbId)).toEqual(['MLB2', 'MLB3']);
  });

  it('ignores duplicate MLB sent within window at same or lower previous price, but allows genuine price drops', () => {
    db.recordSentOffer({
      mlbId: 'MLB100',
      title: 'Produto Teste',
      originalPrice: 200,
      currentPrice: 120,
      discountPercent: 40,
      affiliateUrl: 'https://meli.la/teste',
      groupId: '120363000000@g.us',
    });

    // Mesmo preço -> ignorar
    expect(db.shouldIgnoreAsDuplicate('MLB100', 120, 24)).toBe(true);
    // Preço subiu -> ignorar
    expect(db.shouldIgnoreAsDuplicate('MLB100', 135, 24)).toBe(true);
    // Novo corte de preço (100 < 120) -> aprovar
    expect(db.shouldIgnoreAsDuplicate('MLB100', 100, 24)).toBe(false);
    // Outro MLB -> aprovar
    expect(db.shouldIgnoreAsDuplicate('MLB200', 120, 24)).toBe(false);
  });

  it('deduplicates repeated MLB in the same scraped batch keeping lowest price', () => {
    const offers = [
      makeOffer({ mlbId: 'MLB999', currentPrice: 150, discountPercent: 25 }),
      makeOffer({ mlbId: 'MLB999', currentPrice: 130, discountPercent: 35 }),
    ];

    const result = filterAndDeduplicateOffers(offers, db, {
      minDiscountPercent: 20,
      dedupWindowHours: 24,
    });

    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]?.currentPrice).toBe(130);
  });
});
