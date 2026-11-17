import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { SentOfferRecord } from '../types/offer.js';

export interface RecordSentOfferInput {
  mlbId: string;
  title: string;
  originalPrice: number;
  currentPrice: number;
  discountPercent: number;
  affiliateUrl: string;
  groupId: string;
}

/**
 * Repositório SQLite responsável pelo histórico de envios e deduplicação temporal.
 */
export class OfferDatabase {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(dbPath));
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sent_offers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mlb_id TEXT NOT NULL,
        title TEXT NOT NULL,
        original_price REAL NOT NULL,
        current_price REAL NOT NULL,
        discount_percent REAL NOT NULL,
        affiliate_url TEXT NOT NULL,
        group_id TEXT NOT NULL,
        sent_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_sent_offers_mlb_sent_at
        ON sent_offers (mlb_id, sent_at);
    `);
  }

  /**
   * Verifica se o MLB já foi enviado dentro da janela configurada (ex: 24h ou 48h)
   * por um preço menor ou igual ao preço atual (ou seja, se a oferta atual não é mais barata
   * do que a já enviada recentemente, deve ser ignorada).
   */
  public shouldIgnoreAsDuplicate(
    mlbId: string,
    currentPrice: number,
    windowHours: number,
  ): boolean {
    const stmt = this.db.prepare(`
      SELECT MIN(current_price) AS min_sent_price
      FROM sent_offers
      WHERE mlb_id = ?
        AND datetime(sent_at) >= datetime('now', ?)
    `);

    const row = stmt.get(mlbId, `-${Math.floor(windowHours)} hours`) as
      | { min_sent_price: number | null }
      | undefined;

    if (!row || row.min_sent_price === null) {
      return false;
    }

    // Se já foi enviado pelo mesmo preço ou por um preço ainda menor, ignora.
    return row.min_sent_price <= currentPrice;
  }

  /**
   * Registra o envio de uma oferta SOMENTE após a confirmação de entrega no WhatsApp.
   */
  public recordSentOffer(input: RecordSentOfferInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO sent_offers (
        mlb_id,
        title,
        original_price,
        current_price,
        discount_percent,
        affiliate_url,
        group_id,
        sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    stmt.run(
      input.mlbId,
      input.title,
      input.originalPrice,
      input.currentPrice,
      input.discountPercent,
      input.affiliateUrl,
      input.groupId,
    );
  }

  /**
   * Lista os últimos envios registrados (útil para inspeção/diagnóstico).
   */
  public getRecentSentOffers(limit = 20): SentOfferRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        mlb_id AS mlbId,
        title,
        original_price AS originalPrice,
        current_price AS currentPrice,
        discount_percent AS discountPercent,
        affiliate_url AS affiliateUrl,
        group_id AS groupId,
        sent_at AS sentAt
      FROM sent_offers
      ORDER BY id DESC
      LIMIT ?
    `);

    return stmt.all(limit) as SentOfferRecord[];
  }

  public close(): void {
    this.db.close();
  }
}
