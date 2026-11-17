import { AffiliateService } from '../affiliate/affiliate.service.js';
import { MercadoLivreCollector } from '../collector/mercadolivre.collector.js';
import { env } from '../config/env.js';
import { OfferDatabase } from '../db/database.js';
import { filterAndDeduplicateOffers } from '../filter/offer.filter.js';
import { buildOfferCaption } from '../formatter/message.formatter.js';
import { logger } from '../utils/logger.js';

/**
 * Executa apenas coleta, filtro, conversão de afiliado e preview de mensagem
 * sem disparar mensagens reais no WhatsApp (dry-run).
 */
async function main(): Promise<void> {
  const db = new OfferDatabase(env.SQLITE_DB_PATH);
  const collector = new MercadoLivreCollector();
  const affiliate = new AffiliateService({
    mode: env.AFFILIATE_MODE,
    shortenerUrl: env.AFFILIATE_SHORTENER_URL,
    shortenerToken: env.AFFILIATE_SHORTENER_TOKEN,
    fallbackToParams: env.AFFILIATE_FALLBACK_TO_PARAMS,
    mattWord: env.ML_MATT_WORD,
    mattTool: env.ML_MATT_TOOL,
  });

  try {
    const rawOffers = await collector.collectFromUrls(
      env.ML_OFFER_URLS,
      env.ML_MAX_PAGES_PER_URL,
    );

    const { approved, discardedByDiscount, discardedByDuplicate } =
      filterAndDeduplicateOffers(rawOffers, db, {
        minDiscountPercent: env.MIN_DISCOUNT_PERCENT,
        dedupWindowHours: env.DEDUP_WINDOW_HOURS,
      });

    logger.info(
      {
        collected: rawOffers.length,
        approved: approved.length,
        discardedByDiscount,
        discardedByDuplicate,
      },
      'Dry-run concluído',
    );

    for (const offer of approved.slice(0, 5)) {
      const affiliateUrl =
        env.AFFILIATE_MODE === 'shortener_api' && !env.AFFILIATE_SHORTENER_URL && !env.ML_MATT_WORD
          ? offer.cleanUrl
          : await affiliate.convertToAffiliateUrl(offer.cleanUrl);

      console.log('\n-----------------------------------------');
      console.log(`MLB: ${offer.mlbId} | Imagem: ${offer.imageUrl}`);
      console.log(buildOfferCaption({ ...offer, affiliateUrl }));
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  logger.error({ err }, 'Erro no dry-run');
  process.exit(1);
});
