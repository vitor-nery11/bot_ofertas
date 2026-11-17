import { afterEach, describe, expect, it, vi } from 'vitest';
import { AffiliateService } from '../src/affiliate/affiliate.service.js';
import { buildOfferCaption } from '../src/formatter/message.formatter.js';

describe('AffiliateService & message formatter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends matt_word and matt_tool in params mode', async () => {
    const service = new AffiliateService({
      mode: 'params',
      shortenerUrl: '',
      shortenerToken: '',
      fallbackToParams: false,
      mattWord: 'minha_campanha',
      mattTool: '123456',
    });

    const result = await service.convertToAffiliateUrl(
      'https://produto.mercadolivre.com.br/MLB-123-item',
    );
    expect(result).toBe(
      'https://produto.mercadolivre.com.br/MLB-123-item?matt_word=minha_campanha&matt_tool=123456',
    );
  });

  it('calls shortener API and returns meli.la short link', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ shortUrl: 'https://meli.la/1gAkjWs' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const service = new AffiliateService({
      mode: 'shortener_api',
      shortenerUrl: 'https://shortener.local/api/ml',
      shortenerToken: 'secret',
      fallbackToParams: false,
      mattWord: '',
      mattTool: '',
    });

    const result = await service.convertToAffiliateUrl(
      'https://produto.mercadolivre.com.br/MLB-123-item',
    );
    expect(result).toBe('https://meli.la/1gAkjWs');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('builds WhatsApp caption with discount trigger, strikethrough old price, current price, and link', () => {
    const caption = buildOfferCaption({
      mlbId: 'MLB123',
      title: 'Smart TV 50 4K',
      originalPrice: 2500,
      currentPrice: 1899.9,
      discountPercent: 24,
      cleanUrl: 'https://produto.mercadolivre.com.br/MLB-123-tv',
      imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_123-O.jpg',
      sourceUrl: 'https://www.mercadolivre.com.br/ofertas',
      affiliateUrl: 'https://meli.la/1gAkjWs',
    });

    expect(caption).toContain('24% OFF');
    expect(caption).toContain('Smart TV 50 4K');
    expect(caption).toContain('~R$\u00a02.500,00~');
    expect(caption).toContain('*R$\u00a01.899,90*');
    expect(caption).toContain('https://meli.la/1gAkjWs');
  });
});
