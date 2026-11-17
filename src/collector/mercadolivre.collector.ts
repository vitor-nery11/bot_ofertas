import { chromium, type Browser, type Page } from 'playwright';
import { env } from '../config/env.js';
import type { RawOffer } from '../types/offer.js';
import { logger } from '../utils/logger.js';
import { randomInt, sleep } from '../utils/sleep.js';
import {
  calculateDiscountPercent,
  cleanMercadoLivreUrl,
  extractMlbId,
  parseBrlPrice,
  upgradeImageResolution,
} from './parser.js';

export class BotBlockedError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`Coleta interrompida por proteção/verificação em ${url}: ${reason}`);
    this.name = 'BotBlockedError';
  }
}

interface ScrapedCardCandidate {
  title: string;
  href: string;
  imageUrl: string;
  originalPriceText: string;
  currentPriceText: string;
  discountText: string;
  dataItemId: string;
}

const CHALLENGE_URL_PATTERNS = ['/gz/captcha', '/captcha', 'challenge', 'security-check'];
const CHALLENGE_TEXT_PATTERNS = [
  'não sou um robô',
  'i am not a robot',
  'verify you are human',
  'verificação de segurança',
  'recaptcha',
  'hcaptcha',
  'cloudflare turnstile',
];

/**
 * Coletor baseado em Playwright padrão com cadência moderada e detecção segura
 * de CAPTCHA/bloqueios (interrompe imediatamente sem tentar contornar).
 */
export class MercadoLivreCollector {
  public async collectFromUrls(urls: string[], maxPagesPerUrl: number): Promise<RawOffer[]> {
    const browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
    });

    const collected: RawOffer[] = [];

    try {
      const context = await browser.newContext({
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        viewport: { width: 1366, height: 900 },
      });

      const page = await context.newPage();
      page.setDefaultTimeout(env.PLAYWRIGHT_TIMEOUT_MS);

      for (const baseUrl of urls) {
        const offersFromUrl = await this.scrapeUrlWithPagination(page, baseUrl, maxPagesPerUrl);
        collected.push(...offersFromUrl);
      }
    } finally {
      await browser.close();
    }

    return collected;
  }

  private async scrapeUrlWithPagination(
    page: Page,
    baseUrl: string,
    maxPages: number,
  ): Promise<RawOffer[]> {
    const results: RawOffer[] = [];
    let currentUrl: string | null = baseUrl;

    for (let pageNumber = 1; pageNumber <= maxPages && currentUrl; pageNumber++) {
      logger.info({ url: currentUrl, pageNumber }, 'Acessando página de ofertas do Mercado Livre');

      const response = await page.goto(currentUrl, {
        waitUntil: 'domcontentloaded',
        timeout: env.PLAYWRIGHT_TIMEOUT_MS,
      });

      if (response && (response.status() === 403 || response.status() === 429)) {
        throw new BotBlockedError(currentUrl, `HTTP ${response.status()}`);
      }

      // Aguarda renderização inicial dos cards e verifica se há desafio/CAPTCHA
      await sleep(randomInt(1500, 3000));
      await this.assertNoChallengePage(page);

      // Rola suavemente para carregar imagens lazy-loaded visíveis
      await this.scrollForLazyImages(page);

      const candidates = await this.extractCardCandidates(page);
      logger.info(
        { url: currentUrl, pageNumber, candidatesFound: candidates.length },
        'Cards extraídos da página',
      );

      for (const card of candidates) {
        const normalized = this.normalizeCandidate(card, currentUrl);
        if (normalized) {
          results.push(normalized);
        }
      }

      if (pageNumber < maxPages) {
        currentUrl = await this.findNextPageUrl(page);
        if (currentUrl) {
          await sleep(randomInt(2000, 4500));
        }
      }
    }

    return results;
  }

  private async assertNoChallengePage(page: Page): Promise<void> {
    const currentUrl = page.url().toLowerCase();
    for (const pattern of CHALLENGE_URL_PATTERNS) {
      if (currentUrl.includes(pattern)) {
        throw new BotBlockedError(page.url(), `URL de verificação detectada (${pattern})`);
      }
    }

    const bodyText = await page.evaluate(() => {
      return (document.body?.innerText ?? '').slice(0, 3000).toLowerCase();
    });

    for (const pattern of CHALLENGE_TEXT_PATTERNS) {
      if (bodyText.includes(pattern)) {
        throw new BotBlockedError(page.url(), `Conteúdo de verificação detectado (${pattern})`);
      }
    }
  }

  private async scrollForLazyImages(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const step = 600;
      const maxScroll = Math.min(document.body.scrollHeight, 4800);
      for (let y = 0; y <= maxScroll; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 200));
      }
      window.scrollTo(0, 0);
    });
  }

  private async extractCardCandidates(page: Page): Promise<ScrapedCardCandidate[]> {
    return page.evaluate(() => {
      const selectors = [
        '.poly-card',
        'li.promotion-item',
        'li.ui-search-layout__item',
        '.andes-card.poly-card',
      ];

      const cardSet = new Set<Element>();
      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((el) => cardSet.add(el));
      }

      const items: ScrapedCardCandidate[] = [];

      cardSet.forEach((card) => {
        const linkEl =
          card.querySelector<HTMLAnchorElement>('a.poly-component__title') ??
          card.querySelector<HTMLAnchorElement>('a.promotion-item__link-container') ??
          card.querySelector<HTMLAnchorElement>('a.ui-search-link') ??
          card.querySelector<HTMLAnchorElement>('a[href*="mercadolivre.com"]');

        const href = linkEl?.href ?? '';
        if (!href) return;

        const titleEl =
          card.querySelector('.poly-component__title') ??
          card.querySelector('.promotion-item__title') ??
          card.querySelector('.ui-search-item__title') ??
          linkEl;
        const title = titleEl?.textContent?.trim() ?? '';

        const imgEl = card.querySelector<HTMLImageElement>('img');
        const imageUrl =
          imgEl?.getAttribute('data-src') ??
          imgEl?.getAttribute('src') ??
          imgEl?.currentSrc ??
          '';

        const prevPriceEl =
          card.querySelector('.andes-money-amount--previous') ??
          card.querySelector('s.andes-money-amount') ??
          card.querySelector('.promotion-item__oldprice');
        const originalPriceText = prevPriceEl?.textContent?.trim() ?? '';

        // Preço atual: primeiro andes-money-amount que não seja riscado/anterior
        const priceEls = Array.from(
          card.querySelectorAll('.andes-money-amount, .promotion-item__price'),
        );
        const currentPriceEl = priceEls.find(
          (el) =>
            !el.classList.contains('andes-money-amount--previous') &&
            el.tagName.toLowerCase() !== 's' &&
            !el.closest('.poly-price__installments') &&
            !el.closest('.ui-search-installments'),
        );
        const currentPriceText = currentPriceEl?.textContent?.trim() ?? '';

        const discountEl =
          card.querySelector('.andes-money-amount__discount') ??
          card.querySelector('.promotion-item__discount-text') ??
          card.querySelector('.poly-price__disc_label');
        const discountText = discountEl?.textContent?.trim() ?? '';

        const dataItemId =
          card.getAttribute('data-item-id') ??
          card.querySelector('[data-item-id]')?.getAttribute('data-item-id') ??
          '';

        items.push({
          title,
          href,
          imageUrl,
          originalPriceText,
          currentPriceText,
          discountText,
          dataItemId,
        });
      });

      return items;
    });
  }

  private async findNextPageUrl(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const nextLink =
        document.querySelector<HTMLAnchorElement>('a.andes-pagination__link[title="Seguinte"]') ??
        document.querySelector<HTMLAnchorElement>('li.andes-pagination__button--next a');
      return nextLink?.href ?? null;
    });
  }

  private normalizeCandidate(card: ScrapedCardCandidate, sourceUrl: string): RawOffer | null {
    const cleanUrl = cleanMercadoLivreUrl(card.href);
    const mlbId = extractMlbId(card.dataItemId) ?? extractMlbId(cleanUrl);
    if (!mlbId || !card.title) return null;

    const currentPrice = parseBrlPrice(card.currentPriceText);
    if (!currentPrice) return null;

    const parsedOriginal = parseBrlPrice(card.originalPriceText);
    const originalPrice =
      parsedOriginal && parsedOriginal > currentPrice ? parsedOriginal : currentPrice;

    const discountMatch = card.discountText.match(/(\d{1,2})\s*%/);
    const scrapedPercent = discountMatch?.[1] ? Number.parseInt(discountMatch[1], 10) : null;

    const discountPercent = calculateDiscountPercent(originalPrice, currentPrice, scrapedPercent);
    const imageUrl = upgradeImageResolution(card.imageUrl);

    if (!imageUrl || imageUrl.startsWith('data:')) {
      return null;
    }

    return {
      mlbId,
      title: card.title,
      originalPrice,
      currentPrice,
      discountPercent,
      cleanUrl,
      imageUrl,
      sourceUrl,
    };
  }
}
