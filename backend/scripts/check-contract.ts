import { readFile, writeFile } from 'node:fs/promises';
import { createGenerator } from 'ts-json-schema-generator';
import SwaggerParser from '@apidevtools/swagger-parser';
import YAML from 'yaml';
const path = new URL('../openapi.yaml', import.meta.url);
const document = YAML.parse(await readFile(path, 'utf8'));
const generated = createGenerator({
  path: '../src/contracts/api.ts',
  tsconfig: 'tsconfig.json',
  type: '*',
  expose: 'export',
  skipTypeCheck: true,
}).createSchema('*');
const schemas = JSON.parse(
  JSON.stringify(generated.definitions ?? {}).replaceAll('#/definitions/', '#/components/schemas/'),
);
for (const [name, schema] of Object.entries(schemas)) document.components.schemas[name] = schema;
const resultTypes: Record<string, string> = {
  bootstrap: 'Bootstrap',
  createWorkspace: 'WorkspaceDetail',
  getWorkspace: 'WorkspaceDetail',
  listSources: 'Source[]',
  getSource: 'SourceDetail',
  listConversations: 'Conversation[]',
  getConversation: 'ConversationDetail',
  listEvalCases: 'EvalCase[]',
  createEvalCase: 'EvalCase',
  updateEvalCase: 'EvalCase',
  listEvalRuns: 'EvalRun[]',
  getEvalRun: 'EvalRunDetail',
  reviewEvalResult: 'EvalResult',
  listReleases: 'Release[]',
  snapshotDraft: 'Release',
  getRelease: 'Release',
  releaseChecks: 'ReleaseChecks',
  publish: 'Agent',
  rollback: 'Agent',
  getSettings: 'Settings',
  updateSettings: 'Settings',
  listMembers: 'Member[]raw',
  usage: 'Usage',
  checkout: 'BillingLink',
  billingPortal: 'BillingLink',
  getJob: 'ApiJob',
  notifications: 'Notification[]',
  installations: 'Installation[]raw',
  widgetSession: 'WidgetSession',
  widgetConversation: 'ConversationDetail',
  widgetJob: 'ApiJob',
};
for (const name of new Set(Object.values(resultTypes).map((value) => value.replace(/\[\]raw$|\[\]$/g, '')))) {
  const standalone = createGenerator({
    path: '../src/contracts/api.ts',
    tsconfig: 'tsconfig.json',
    type: name,
    expose: 'export',
    skipTypeCheck: true,
  }).createSchema(name);
  const supplemental = JSON.parse(
    JSON.stringify(standalone.definitions ?? {}).replaceAll('#/definitions/', '#/components/schemas/'),
  );
  for (const [schemaName, schema] of Object.entries(supplemental))
    document.components.schemas[schemaName] = schema;
}
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
document.paths['/public/sessions'].post.requestBody = {
  required: true,
  content: { 'application/json': { schema: ref('WidgetSessionRequest') } },
};
document.components.parameters.limit = {
  name: 'limit',
  in: 'query',
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
};
document.components.parameters.cursor = {
  name: 'cursor',
  in: 'query',
  schema: { type: 'string', format: 'uuid' },
};
document.components.responses.Accepted = {
  description: 'Durable operation accepted; poll jobId for completion.',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['data', 'requestId'],
        properties: { data: ref('Accepted'), requestId: { type: 'string' } },
      },
    },
  },
};
for (const item of Object.values(document.paths) as any[])
  for (const operation of Object.values(item) as any[]) {
    if (!operation?.operationId) continue;
    let name = resultTypes[operation.operationId];
    if (!name) continue;
    let schema: any;
    if (name.endsWith('[]raw')) schema = { type: 'array', items: ref(name.slice(0, -5)) };
    else if (name.endsWith('[]')) {
      schema = {
        type: 'object',
        required: ['items', 'nextCursor'],
        properties: {
          items: { type: 'array', items: ref(name.slice(0, -2)) },
          nextCursor: { type: ['string', 'null'] },
        },
      };
      operation.parameters = (operation.parameters ?? []).filter(
        (p: any) => !['#/components/parameters/limit', '#/components/parameters/cursor'].includes(p.$ref),
      );
      operation.parameters.push(
        { $ref: '#/components/parameters/limit' },
        { $ref: '#/components/parameters/cursor' },
      );
    } else schema = ref(name);
    for (const code of ['200', '201'])
      if (operation.responses[code])
        operation.responses[code] = {
          description: name,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'requestId'],
                properties: { data: schema, requestId: { type: 'string' } },
              },
            },
          },
        };
  }
const safeName = (name: string) => decodeURIComponent(name).replace(/[^a-zA-Z0-9._-]/g, '_');
document.components.schemas = Object.fromEntries(
  Object.entries(document.components.schemas).map(([name, value]) => [safeName(name), value]),
);
function normalize(value: any): void {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/schemas/'))
    value.$ref = `#/components/schemas/${safeName(value.$ref.slice('#/components/schemas/'.length))}`;
  // Database response projections may add metadata; consumers can ignore additive fields.
  if (value.additionalProperties === false) delete value.additionalProperties;
  for (const child of Object.values(value)) normalize(child);
}
normalize(document);
await SwaggerParser.validate(structuredClone(document));
// Validate a clone: dereferencing mutates and may introduce circular JS objects.
if (process.argv.includes('--write')) await writeFile(path, YAML.stringify(document, { lineWidth: 120 }));
console.log(
  `OpenAPI validated: ${Object.keys(document.paths).length} paths; ${Object.keys(document.components.schemas).length} schemas.`,
);
