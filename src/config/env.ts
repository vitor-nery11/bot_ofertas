import 'dotenv/config';
import { z } from 'zod';

const booleanFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return defaultValue;
      return val.trim().toLowerCase() === 'true';
    });

const csvFromEnv = (defaultValue: string[]) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val.trim() === '') return defaultValue;
      return val
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    });

const envSchema = z.object({
  // Agendamento
  CRON_SCHEDULE: z.string().default('*/15 * * * *'),
  RUN_ON_STARTUP: booleanFromEnv(false),
  JITTER_MIN_SECONDS: z.coerce.number().int().min(0).default(5),
  JITTER_MAX_SECONDS: z.coerce.number().int().min(0).default(25),

  // Coleta Playwright
  ML_OFFER_URLS: csvFromEnv(['https://www.mercadolivre.com.br/ofertas']),
  ML_MAX_PAGES_PER_URL: z.coerce.number().int().min(1).max(20).default(2),
  PLAYWRIGHT_HEADLESS: booleanFromEnv(true),
  PLAYWRIGHT_TIMEOUT_MS: z.coerce.number().int().min(5000).default(30000),

  // Filtragem & SQLite
  MIN_DISCOUNT_PERCENT: z.coerce.number().min(0).max(99).default(20),
  DEDUP_WINDOW_HOURS: z.coerce.number().min(1).max(720).default(24),
  SQLITE_DB_PATH: z.string().default('./data/offers.sqlite'),

  // Afiliado
  AFFILIATE_MODE: z.enum(['shortener_api', 'params', 'none']).default('shortener_api'),
  AFFILIATE_SHORTENER_URL: z.string().default(''),
  AFFILIATE_SHORTENER_TOKEN: z.string().default(''),
  AFFILIATE_FALLBACK_TO_PARAMS: booleanFromEnv(true),
  ML_MATT_WORD: z.string().default(''),
  ML_MATT_TOOL: z.string().default(''),

  // BullMQ / Redis
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  SEND_DELAY_MIN_MS: z.coerce.number().int().min(1000).default(15000),
  SEND_DELAY_MAX_MS: z.coerce.number().int().min(1000).default(45000),

  // WhatsApp (Baileys)
  WA_AUTH_DIR: z.string().default('./auth_info_baileys'),
  WA_TARGET_GROUPS: csvFromEnv([]),

  // Logs
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Erro na validação das variáveis de ambiente (.env):');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type AppEnv = typeof env;
