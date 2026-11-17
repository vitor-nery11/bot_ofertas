import { logger } from '../utils/logger.js';

export type AffiliateMode = 'shortener_api' | 'params' | 'none';

export interface AffiliateConfig {
  mode: AffiliateMode;
  shortenerUrl: string;
  shortenerToken: string;
  fallbackToParams: boolean;
  mattWord: string;
  mattTool: string;
}

/**
 * Converte URLs limpas do Mercado Livre em links rastreáveis de afiliado.
 * Suporta:
 * - "shortener_api": chama endpoint configurável para gerar links curtos (ex: https://meli.la/...)
 * - "params": injeta parâmetros matt_word / matt_tool diretamente na URL
 * - "none": retorna a URL limpa sem alterações (útil apenas em testes)
 */
export class AffiliateService {
  constructor(private readonly config: AffiliateConfig) {}

  public async convertToAffiliateUrl(cleanUrl: string): Promise<string> {
    if (this.config.mode === 'none') {
      return cleanUrl;
    }

    if (this.config.mode === 'params') {
      return this.buildParamsUrl(cleanUrl);
    }

    // mode === 'shortener_api'
    if (!this.config.shortenerUrl) {
      if (this.config.fallbackToParams && (this.config.mattWord || this.config.mattTool)) {
        logger.warn(
          'AFFILIATE_SHORTENER_URL não configurada; aplicando fallback com parâmetros matt_word/matt_tool.',
        );
        return this.buildParamsUrl(cleanUrl);
      }

      throw new Error(
        'AFFILIATE_MODE="shortener_api" exige AFFILIATE_SHORTENER_URL configurada no .env (ou fallback via ML_MATT_WORD/ML_MATT_TOOL).',
      );
    }

    try {
      return await this.requestShortener(cleanUrl);
    } catch (error) {
      if (this.config.fallbackToParams && (this.config.mattWord || this.config.mattTool)) {
        logger.warn(
          { err: error, cleanUrl },
          'Falha ao gerar link curto de afiliado; usando fallback por parâmetros.',
        );
        return this.buildParamsUrl(cleanUrl);
      }
      throw error;
    }
  }

  private async requestShortener(cleanUrl: string): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.shortenerToken) {
      headers.Authorization = `Bearer ${this.config.shortenerToken}`;
    }

    const response = await fetch(this.config.shortenerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: cleanUrl }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Shortener respondeu HTTP ${response.status}: ${text.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const candidate =
      data.shortUrl ?? data.short_url ?? data.affiliateUrl ?? data.affiliate_url ?? data.url ?? data.link;

    if (typeof candidate !== 'string' || !candidate.startsWith('http')) {
      throw new Error('Resposta do shortener não contém URL válida.');
    }

    return candidate;
  }

  public buildParamsUrl(cleanUrl: string): string {
    const url = new URL(cleanUrl);
    if (this.config.mattWord) {
      url.searchParams.set('matt_word', this.config.mattWord);
    }
    if (this.config.mattTool) {
      url.searchParams.set('matt_tool', this.config.mattTool);
    }
    return url.toString();
  }
}
