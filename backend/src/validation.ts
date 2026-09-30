import { z } from 'zod';
export const uuid = z.uuid();
export const authority = z.enum(['approved', 'authoritative', 'reference']);
export const sourceKind = z.enum([
  'website',
  'sitemap',
  'pdf',
  'text',
  'markdown',
  'qa_csv',
  'qa_xlsx',
  'approved_answer',
]);
export const sourceInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: sourceKind,
    url: z.url().optional(),
    content: z.string().min(1).max(1_000_000).optional(),
    authority: authority.default('reference'),
    approvalRequired: z.boolean().default(false),
    dependsOnSourceIds: z.array(uuid).max(50).default([]),
    crawlPolicy: z
      .object({
        maxPages: z.number().int().min(1).max(100),
        excludePaths: z.array(z.string().max(200)).max(100),
        selectedUrls: z.array(z.url()).max(100),
      })
      .optional(),
  })
  .strict();
export const sourceUpdate = z
  .object({
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    authority: authority.optional(),
    approvalRequired: z.boolean().optional(),
    action: z.enum(['archive', 'restore']).optional(),
    content: z.string().min(1).max(1_000_000).optional(),
    dependsOnSourceIds: z.array(uuid).max(50).optional(),
    crawlPolicy: z
      .object({
        maxPages: z.number().int().min(1).max(100),
        excludePaths: z.array(z.string().max(200)).max(100),
        selectedUrls: z.array(z.url()).max(100),
      })
      .optional(),
  })
  .strict();
export const question = z
  .object({
    question: z.string().trim().min(1).max(4000),
    conversationId: uuid.optional(),
    releaseId: uuid.optional(),
  })
  .strict();
export const feedback = z
  .object({
    messageId: uuid,
    rating: z.enum(['helpful', 'unhelpful']),
    comment: z.string().max(2000).optional(),
  })
  .strict();
export const handoff = z
  .object({
    email: z.email().max(254),
    name: z.string().max(120).default(''),
    message: z.string().max(4000).default(''),
  })
  .strict();
export const caseInput = z
  .object({
    caseId: z.string().max(100).optional(),
    question: z.string().min(1).max(4000),
    conversationContext: z.string().max(8000).optional(),
    previousAnswer: z.string().max(8000).optional(),
    expectedFacts: z.array(z.string().max(1000)).max(30),
    sourceIds: z.array(uuid).max(50).default([]),
    category: z.string().max(100).optional(),
    importance: z.enum(['normal', 'critical']),
    split: z.enum(['development', 'holdout']),
    baselineTimestamp: z.iso.datetime().optional(),
    control: z.boolean().default(false),
  })
  .strict();
export const agentConfig = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000),
    tone: z.string().max(200),
    instructions: z.string().max(4000),
    supportEmail: z.email(),
    handoffMessage: z.string().min(1).max(1000),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    starterQuestions: z.array(z.string().max(200)).max(6),
    allowedOrigins: z
      .array(
        z.url().refine((v) => {
          const u = new URL(v);
          return ['http:', 'https:'].includes(u.protocol) && u.origin === v;
        }),
      )
      .max(20),
    autoPublish: z.boolean(),
    ragPolicy: z
      .object({
        topK: z.number().int().min(1).max(8),
        minSimilarity: z.number().min(0).max(1),
        chunkSizeChars: z.number().int().min(500).max(2400),
        chunkOverlapChars: z.number().int().min(0).max(1000),
        maxHistoryChars: z.number().int().min(0).max(6000),
      })
      .refine(
        (value) => value.chunkOverlapChars < value.chunkSizeChars,
        'Chunk overlap must be smaller than chunk size',
      )
      .optional(),
  })
  .strict();
export const publishInput = z
  .object({ expectedPublishedReleaseId: uuid.nullable(), acknowledgeWarnings: z.boolean() })
  .strict();
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: uuid.optional(),
  q: z.string().max(200).optional(),
});
