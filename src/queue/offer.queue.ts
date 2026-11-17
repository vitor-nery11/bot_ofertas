import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { OfferDatabase } from '../db/database.js';
import { buildOfferCaption, downloadOfferImage } from '../formatter/message.formatter.js';
import type { AffiliateOffer, SendOfferJobData } from '../types/offer.js';
import { logger } from '../utils/logger.js';
import { randomInt, sleep } from '../utils/sleep.js';
import type { WhatsAppProvider } from '../whatsapp/whatsapp.provider.js';

export const OFFER_QUEUE_NAME = 'whatsapp-offer-dispatch';

export interface OfferQueueConfig {
  redisUrl: string;
  sendDelayMinMs: number;
  sendDelayMaxMs: number;
  targetGroups: string[];
}

/**
 * Gerencia a fila BullMQ e o Worker sequencial (1 oferta por vez, delay 15-45s)
 * responsável por baixar a imagem nativa, disparar no WhatsApp e registrar no SQLite.
 */
export class OfferQueueService {
  private readonly connection: Redis;
  private readonly queue: Queue<SendOfferJobData>;
  private worker: Worker<SendOfferJobData> | null = null;

  constructor(
    private readonly config: OfferQueueConfig,
    private readonly db: OfferDatabase,
    private readonly whatsapp: WhatsAppProvider,
  ) {
    this.connection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<SendOfferJobData>(OFFER_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10000,
        },
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    });
  }

  public startWorker(): void {
    if (this.worker) return;

    this.worker = new Worker<SendOfferJobData>(
      OFFER_QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        connection: this.connection,
        concurrency: 1,
      },
    );

    this.worker.on('completed', (job) => {
      logger.info(
        { jobId: job.id, mlbId: job.data.offer.mlbId },
        'Oferta processada e enviada com sucesso',
      );
    });

    this.worker.on('failed', (job, err) => {
      logger.error(
        { jobId: job?.id, mlbId: job?.data.offer.mlbId, err },
        'Falha ao processar job de envio de oferta',
      );
    });
  }

  public async enqueueOffer(offer: AffiliateOffer): Promise<boolean> {
    if (this.config.targetGroups.length === 0) {
      logger.warn(
        { mlbId: offer.mlbId },
        'Nenhum grupo configurado em WA_TARGET_GROUPS; oferta não enfileirada.',
      );
      return false;
    }

    const priceInCents = Math.round(offer.currentPrice * 100);
    const jobId = `${offer.mlbId}_${priceInCents}`;

    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') {
        logger.debug({ jobId }, 'Job já presente na fila; ignorando duplicata');
        return false;
      }
      await existingJob.remove();
    }

    await this.queue.add(
      'send-offer',
      {
        offer,
        targetGroups: this.config.targetGroups,
        enqueuedAt: new Date().toISOString(),
      },
      { jobId },
    );

    logger.info(
      { mlbId: offer.mlbId, discount: offer.discountPercent, price: offer.currentPrice },
      'Oferta enfileirada no BullMQ',
    );
    return true;
  }

  private async processJob(job: Job<SendOfferJobData>): Promise<void> {
    const { offer, targetGroups } = job.data;

    if (!this.whatsapp.isConnected()) {
      throw new Error('WhatsApp desconectado; aguardando reconexão para retentativa do BullMQ.');
    }

    const caption = buildOfferCaption(offer);
    const imageBuffer = await downloadOfferImage(offer.imageUrl);

    for (let i = 0; i < targetGroups.length; i++) {
      const groupId = targetGroups[i];
      if (!groupId) continue;

      await this.whatsapp.sendImageMessage(groupId, imageBuffer, caption);

      // Grava no SQLite somente após confirmação do envio pela API do WhatsApp
      this.db.recordSentOffer({
        mlbId: offer.mlbId,
        title: offer.title,
        originalPrice: offer.originalPrice,
        currentPrice: offer.currentPrice,
        discountPercent: offer.discountPercent,
        affiliateUrl: offer.affiliateUrl,
        groupId,
      });

      logger.info({ mlbId: offer.mlbId, groupId }, 'Mídia enviada e registrada no SQLite');

      if (i < targetGroups.length - 1) {
        await sleep(randomInt(2000, 4500));
      }
    }

    // Cooldown anti-spam de 15 a 45 segundos entre ofertas da fila
    const cooldownMs = randomInt(this.config.sendDelayMinMs, this.config.sendDelayMaxMs);
    logger.debug({ cooldownMs, mlbId: offer.mlbId }, 'Aguardando delay entre disparos da fila');
    await sleep(cooldownMs);
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
    await this.connection.quit();
  }
}
