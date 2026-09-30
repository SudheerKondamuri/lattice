import 'dotenv/config';
import { z } from 'zod';
const integer = (fallback: number, max = 1_000_000_000) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
    schema.optional(),
  );
const endpoint = z.url().refine((value) => {
  const u = new URL(value);
  return (
    u.protocol === 'https:' &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    (u.pathname === '/' || u.pathname === '')
  );
}, 'Use an HTTPS resource origin without credentials, query or path');
export const configSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgres'),
  APP_ORIGIN: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_JWT_AUDIENCE: z.string().default('authenticated'),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,63}$/)
    .default('lattice-originals'),
  BILLING_ENABLED: z.enum(['true', 'false']).default('false'),
  AI_PROVIDER: z.enum(['openai', 'azure']).default('openai'),
  PORT: integer(4000, 65535),
  HOST: z.string().default('0.0.0.0'),
  TRUST_PROXY: z.string().default('false'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_POOL_SIZE: integer(10, 50),
  OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: optional(endpoint),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(?:-preview)?$/)
    .default('2024-10-21'),
  AZURE_OPENAI_ANSWER_DEPLOYMENT: optional(z.string().trim().min(1).max(128)),
  AZURE_OPENAI_GRADING_DEPLOYMENT: optional(z.string().trim().min(1).max(128)),
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: optional(z.string().trim().min(1).max(128)),
  ANSWER_MODEL: z.string().default('gpt-4.1-mini-2025-04-14'),
  GRADING_MODEL: z.string().default('gpt-4.1-2025-04-14'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_STARTER_PRICE_ID: z.string().optional(),
  STRIPE_GROWTH_PRICE_ID: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_DELIVERY_ENABLED: z.enum(['true', 'false']).default('false'),
  PARSER_PYTHON: z.string().default('python3'),
  PARSER_ARTIFACTS_PATH: z.string().default('/opt/docling-models'),
  PARSER_TIMEOUT_MS: integer(120000, 180000),
  WORKER_CONCURRENCY: integer(2, 8),
  GLOBAL_DAILY_SPEND_MICROS: integer(5_000_000),
  DEFAULT_MONTHLY_SPEND_MICROS: integer(10_000_000),
  ANSWER_RESERVE_MICROS: integer(50_000),
  CHECK_RESERVE_MICROS: integer(150_000),
  EMBEDDING_RESERVE_MICROS: integer(10_000),
  OCR_RESERVE_MICROS: integer(20_000),
  AI_INPUT_MICROS_PER_MILLION: integer(400_000),
  AI_OUTPUT_MICROS_PER_MILLION: integer(1_600_000),
  EMBEDDING_MICROS_PER_MILLION: integer(20_000),
  GRADING_INPUT_MICROS_PER_MILLION: integer(2_000_000),
  GRADING_OUTPUT_MICROS_PER_MILLION: integer(8_000_000),
  MAX_UPLOAD_BYTES: integer(10 * 1024 * 1024, 20 * 1024 * 1024),
  MAX_WORKSPACE_STORAGE_BYTES: integer(100 * 1024 * 1024),
  MAX_CRAWL_PAGES: integer(50, 100),
  MAX_PDF_PAGES: integer(100, 200),
  MAX_OCR_PAGES: integer(10, 20),
  TRIAL_WORKSPACES_PER_USER: integer(1, 5),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(): Config {
  return configSchema.parse(process.env);
}
