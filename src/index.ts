import { AffiliateService } from './affiliate/affiliate.service.js';
import { MercadoLivreCollector } from './collector/mercadolivre.collector.js';
import { env } from './config/env.js';
import { OfferDatabase } from './db/database.js';
import { OfferQueueService } from './queue/offer.queue.js';
import { OfferScheduler } from './scheduler/cron.scheduler.js';
import { logger } from './utils/logger.js';
import { BaileysWhatsAppProvider } from './whatsapp/baileys.provider.js';

async function bootstrap(): Promise<void> {
  logger.info('Iniciando Bot de Ofertas...');

  const db = new OfferDatabase(env.SQLITE_DB_PATH);
  const whatsapp = new BaileysWhatsAppProvider(env.WA_AUTH_DIR);

  await whatsapp.connect();

  const queue = new OfferQueueService(
    {
      redisUrl: env.REDIS_URL,
      sendDelayMinMs: env.SEND_DELAY_MIN_MS,
      sendDelayMaxMs: env.SEND_DELAY_MAX_MS,
      targetGroups: env.WA_TARGET_GROUPS,
    },
    db,
    whatsapp,
  );
  queue.startWorker();

  const affiliate = new AffiliateService({
    mode: env.AFFILIATE_MODE,
    shortenerUrl: env.AFFILIATE_SHORTENER_URL,
    shortenerToken: env.AFFILIATE_SHORTENER_TOKEN,
    fallbackToParams: env.AFFILIATE_FALLBACK_TO_PARAMS,
    mattWord: env.ML_MATT_WORD,
    mattTool: env.ML_MATT_TOOL,
  });

  const collector = new MercadoLivreCollector();
  const scheduler = new OfferScheduler(
    {
      cronSchedule: env.CRON_SCHEDULE,
      jitterMinSeconds: env.JITTER_MIN_SECONDS,
      jitterMaxSeconds: env.JITTER_MAX_SECONDS,
      offerUrls: env.ML_OFFER_URLS,
      maxPagesPerUrl: env.ML_MAX_PAGES_PER_URL,
      minDiscountPercent: env.MIN_DISCOUNT_PERCENT,
      dedupWindowHours: env.DEDUP_WINDOW_HOURS,
    },
    { collector, db, affiliate, queue },
  );

  scheduler.start();

  if (env.RUN_ON_STARTUP) {
    void scheduler.runCycle(false);
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando Bot de Ofertas com segurança...');
    scheduler.stop();
    await queue.close();
    await whatsapp.disconnect();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Falha fatal ao inicializar o bot');
  process.exit(1);
});
