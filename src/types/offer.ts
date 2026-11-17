/**
 * Domínio principal das ofertas coletadas, filtradas e enfileiradas para disparo.
 */

export interface RawOffer {
  /** ID único do anúncio no Mercado Livre (ex: MLB1234567890) */
  mlbId: string;
  /** Título do produto */
  title: string;
  /** Preço original antes do desconto (pode ser igual ao atual se não houver "de/por") */
  originalPrice: number;
  /** Preço promocional atual */
  currentPrice: number;
  /** Percentual de desconto inteiro ou arredondado (0-100) */
  discountPercent: number;
  /** URL limpa e canônica do anúncio (sem query strings de tracking) */
  cleanUrl: string;
  /** URL da imagem do produto em alta resolução */
  imageUrl: string;
  /** URL da página onde o item foi coletado */
  sourceUrl: string;
}

export interface AffiliateOffer extends RawOffer {
  /** URL convertida para link de afiliado rastreável (ex: https://meli.la/...) */
  affiliateUrl: string;
}

export interface SendOfferJobData {
  offer: AffiliateOffer;
  targetGroups: string[];
  enqueuedAt: string;
}

export interface SentOfferRecord {
  id: number;
  mlbId: string;
  title: string;
  originalPrice: number;
  currentPrice: number;
  discountPercent: number;
  affiliateUrl: string;
  groupId: string;
  sentAt: string;
}
