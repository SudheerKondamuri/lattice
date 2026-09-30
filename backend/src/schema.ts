/** Drizzle model for vector retrieval. The full reviewed schema is migrations/0000_core.sql. */
import { pgTable, uuid, text, integer, jsonb, vector, timestamp } from 'drizzle-orm/pg-core';
export const chunks = pgTable('chunks', {
  id: uuid().primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  sourceVersionId: uuid('source_version_id').notNull(),
  ordinal: integer().notNull(),
  content: text().notNull(),
  reference: jsonb().notNull(),
  embedding: vector({ dimensions: 1536 }).notNull(),
});
export const releases = pgTable('releases', {
  id: uuid().primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  label: text().notNull(),
  config: jsonb().notNull(),
  draftRevision: integer('draft_revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
