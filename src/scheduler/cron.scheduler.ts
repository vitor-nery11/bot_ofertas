import cron, { type ScheduledTask } from 'node-cron';
import type { AffiliateService } from '../affiliate/affiliate.service.js';
import { BotBlockedError, type MercadoLivreCollector } from '../collector/mercadolivre.collector.js';
import type { OfferDatabase } from '../db/database.js';
import { filterAndDeduplicateOffers } from '../filter/offer.filter.js';
import type { OfferQueueService } from '../queue/offer.queue.js';
import { logger } from '../utils/logger.js';
import { randomInt, sleep } from '../utils/sleep.js';

export interface SchedulerConfig {
  cronSchedule: string;
  jitterMinSeconds: number;
  jitterMaxSeconds: number;
  offerUrls: string[];
  maxPagesPerUrl: number;
  minDiscountPercent: number;
  dedupWindowHours: number;
}

export interface CycleDependencies {
  collector: MercadoLivreCollector;
  db: OfferDatabase;
  affiliate: AffiliateService;
  queue: OfferQueueService;
}

/**
 * Orquestra a execução periódica do bot:
 * Cron -> Jitter -> Coleta (Playwright) -> Filtro/SQLite -> Afiliado -> BullMQ.
 */
export class OfferScheduler {
  private task: ScheduledTask | null = null;
  private isCycleRunning = false;

  constructor(
    private readonly config: SchedulerConfig,
    private readonly deps: CycleDependencies,
  ) {}

  public start(): void {
    if (!cron.validate(this.config.cronSchedule)) {
      throw new Error(`Expressão cron inválida: ${this.config.cronSchedule}`);
    }

    this.task = cron.schedule(this.config.cronSchedule, () => {
      void this.runCycle(true);
    });

    logger.info(
      { cronSchedule: this.config.cronSchedule },
      'Agendador cron iniciado com sucesso',
    );
  }

  public stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  public async runCycle(applyJitter = true): Promise<void> {
    if (this.isCycleRunning) {
      logger.warn('Ciclo anterior ainda está em execução; pulando disparo atual.');
      return;
    }

    this.isCycleRunning = true;

    try {
      if (applyJitter && this.config.jitterMaxSeconds > 0) {
        const jitterSec = randomInt(this.config.jitterMinSeconds, this.config.jitterMaxSeconds);
        logger.info({ jitterSec }, 'Aplicando jitter antes de iniciar a coleta');
        await sleep(jitterSec * 1000);
      }

      logger.info('Iniciando ciclo de varredura de ofertas');
      const rawOffers = await this.deps.collector.collectFromUrls(
        this.config.offerUrls,
        this.config.maxPagesPerUrl,
      );

      const { approved, discardedByDiscount, discardedByDuplicate } =
        filterAndDeduplicateOffers(rawOffers, this.deps.db, {
          minDiscountPercent: this.config.minDiscountPercent,
          dedupWindowHours: this.config.dedupWindowHours,
        });

      logger.info(
        {
          collected: rawOffers.length,
          approved: approved.length,
          discardedByDiscount,
          discardedByDuplicate,
        },
        'Resultado da filtragem e deduplicação',
      );

      let enqueuedCount = 0;
      for (const offer of approved) {
        try {
          const affiliateUrl = await this.deps.affiliate.convertToAffiliateUrl(offer.cleanUrl);
          const enqueued = await this.deps.queue.enqueueOffer({
            ...offer,
            affiliateUrl,
          });
          if (enqueued) enqueuedCount++;
        } catch (err) {
          logger.error(
            { err, mlbId: offer.mlbId, cleanUrl: offer.cleanUrl },
            'Erro ao converter link de afiliado ou enfileirar oferta',
          );
        }
      }

      logger.info({ enqueuedCount }, 'Ciclo de varredura finalizado');
    } catch (err) {
      if (err instanceof BotBlockedError) {
        logger.error(
          { url: err.url, reason: err.reason },
          'ALERTA: Coleta interrompida por CAPTCHA/verificação no Mercado Livre. Aguardando próximo ciclo.',
        );
      } else {
        logger.error({ err }, 'Erro inesperado durante o ciclo de coleta');
      }
    } finally {
      this.isCycleRunning = false;
    }
  }
}
