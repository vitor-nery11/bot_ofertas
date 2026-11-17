import { describe, expect, it } from 'vitest';
import {
  calculateDiscountPercent,
  cleanMercadoLivreUrl,
  extractMlbId,
  parseBrlPrice,
  upgradeImageResolution,
} from '../src/collector/parser.js';

describe('parser utilities', () => {
  it('parses Brazilian currency strings accurately', () => {
    expect(parseBrlPrice('R$ 1.299,90')).toBe(1299.9);
    expect(parseBrlPrice('299,50')).toBe(299.5);
    expect(parseBrlPrice('R$ 1.200')).toBe(1200);
    expect(parseBrlPrice('')).toBeNull();
    expect(parseBrlPrice(null)).toBeNull();
  });

  it('extracts and normalizes MLB IDs', () => {
    expect(extractMlbId('https://produto.mercadolivre.com.br/MLB-3849201923-fone')).toBe(
      'MLB3849201923',
    );
    expect(extractMlbId('mlb123456789')).toBe('MLB123456789');
    expect(extractMlbId('https://www.mercadolivre.com.br/ofertas')).toBeNull();
  });

  it('strips tracking query parameters and hashes from URLs', () => {
    const raw =
      'https://produto.mercadolivre.com.br/MLB-123456789-produto?matt_word=abc&tracking_id=xyz#polycard_client=offers';
    expect(cleanMercadoLivreUrl(raw)).toBe(
      'https://produto.mercadolivre.com.br/MLB-123456789-produto',
    );
  });

  it('upgrades mlstatic thumbnail URLs to high-resolution -O format', () => {
    expect(upgradeImageResolution('https://http2.mlstatic.com/D_NQ_NP_123456-MLA123-I.jpg')).toBe(
      'https://http2.mlstatic.com/D_NQ_NP_123456-MLA123-O.jpg',
    );
    expect(upgradeImageResolution('https://http2.mlstatic.com/D_NQ_NP_123456-MLA123-V.webp')).toBe(
      'https://http2.mlstatic.com/D_NQ_NP_123456-MLA123-O.webp',
    );
  });

  it('calculates discount percent from prices or falls back to scraped percent', () => {
    expect(calculateDiscountPercent(200, 150)).toBe(25);
    expect(calculateDiscountPercent(150, 150, 30)).toBe(30);
    expect(calculateDiscountPercent(100, 100, null)).toBe(0);
  });
});
