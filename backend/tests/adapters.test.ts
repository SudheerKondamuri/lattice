import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { aiProvider, openAI, resend } from '../src/providers.js';
import { supabaseAuth } from '../src/auth.js';
import { safeFetch } from '../src/network.js';
import { plainText, qaCsv, chunkSections, pythonParse, crawl } from '../src/parsing.js';
import { testConfig } from './helpers.js';
import { configSchema } from '../src/config.js';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { randomUUID } from 'node:crypto';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('Real adapter protocol boundaries, with test-only transport fixtures', () => {
  it('accepts blank optional values in the distributed env template', () => {
    const config = configSchema.parse({
      ...testConfig,
      AZURE_OPENAI_ENDPOINT: '',
      AZURE_OPENAI_ANSWER_DEPLOYMENT: '',
      AZURE_OPENAI_GRADING_DEPLOYMENT: '',
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: '',
    });
    expect(config.AZURE_OPENAI_ENDPOINT).toBeUndefined();
  });
  it('routes answer and grading to separate Azure deployments even when model labels match', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    url.includes('/grader/')
                      ? { supported: true, missingFacts: [], limitations: 'Preliminary' }
                      : { content: 'Clarify', disposition: 'clarification', citationIds: [] },
                  ),
                },
              },
            ],
          }),
        );
      }),
    );
    const provider = aiProvider({
      ...testConfig,
      AI_PROVIDER: 'azure',
      ANSWER_MODEL: 'same-model',
      GRADING_MODEL: 'same-model',
      AZURE_OPENAI_ENDPOINT: 'https://resource.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'test-only',
      AZURE_OPENAI_ANSWER_DEPLOYMENT: 'answer',
      AZURE_OPENAI_GRADING_DEPLOYMENT: 'grader',
    });
    await provider.answer('q', '', [], {
      name: 'Bot',
      description: '',
      tone: '',
      instructions: '',
      supportEmail: 's@example.com',
      handoffMessage: 'Email us',
      accentColor: '#000000',
      starterQuestions: [],
      allowedOrigins: [],
      autoPublish: false,
    });
    await provider.grade('q', 'a', [], []);
    expect(urls[0]).toContain('/answer/');
    expect(urls[1]).toContain('/grader/');
  });
  it('uses Azure deployment routes and api-key authentication without sending a public OpenAI key', async () => {
    const fetcher = vi.fn(async (url: string, request: RequestInit) => {
      const headers = request.headers as Record<string, string>;
      expect(headers['api-key']).toBe('azure-test-key');
      expect(headers.Authorization).toBeUndefined();
      expect(url).toMatch(
        /https:\/\/resource\.openai\.azure\.com\/openai\/deployments\/(answer-deployment|embedding-deployment)\//,
      );
      const body = JSON.parse(String(request.body));
      expect(body.model).toBeUndefined();
      if (url.includes('/embeddings'))
        return new Response(JSON.stringify({ data: [{ index: 0, embedding: new Array(1536).fill(0.1) }] }));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ content: 'Answer', disposition: 'answer', citationIds: [] }),
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 2 },
        }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const azure = aiProvider({
      ...testConfig,
      AI_PROVIDER: 'azure',
      AZURE_OPENAI_ENDPOINT: 'https://resource.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'azure-test-key',
      AZURE_OPENAI_API_VERSION: '2024-10-21',
      AZURE_OPENAI_ANSWER_DEPLOYMENT: 'answer-deployment',
      AZURE_OPENAI_GRADING_DEPLOYMENT: 'answer-deployment',
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: 'embedding-deployment',
    });
    await azure.embed(['hello']);
    await azure.answer('question', '', [], {
      name: 'Bot',
      description: '',
      tone: '',
      instructions: '',
      supportEmail: 's@example.com',
      handoffMessage: 'Email us',
      accentColor: '#000000',
      starterQuestions: [],
      allowedOrigins: [],
      autoPublish: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('bounds UTF-8 embedding tokens and escaped prompt bytes before making a paid request', async () => {
    const outbound = vi.fn(async () => {
      throw new Error('Paid request escaped its input bound');
    });
    vi.stubGlobal('fetch', outbound);
    await expect(
      openAI({ ...testConfig, OPENAI_API_KEY: 'test-only' }).embed(['界'.repeat(3000)]),
    ).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    const ai = openAI({ ...testConfig, OPENAI_API_KEY: 'test-only' });
    await expect(
      ai.answer(
        'q',
        '\u0001'.repeat(6000),
        [
          {
            sourceId: randomUUID(),
            sourceVersionId: randomUUID(),
            chunkId: randomUUID(),
            title: 'Untrusted',
            authority: 'reference',
            excerpt: '\u0001'.repeat(18000),
            eligible: true,
          },
        ],
        {
          name: 'Bot',
          description: '\u0001'.repeat(2000),
          tone: '',
          instructions: '\u0001'.repeat(4000),
          supportEmail: 's@example.com',
          handoffMessage: 'Email us',
          accentColor: '#000000',
          starterQuestions: [],
          allowedOrigins: [],
          autoPublish: false,
        },
      ),
    ).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    expect(outbound).not.toHaveBeenCalled();
  });
  it('requires real AI configuration and validates provider dimensions', async () => {
    await expect(openAI(testConfig).embed(['hi'])).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), { status: 200 }),
      ),
    );
    await expect(openAI({ ...testConfig, OPENAI_API_KEY: 'test-only' }).embed(['hi'])).rejects.toThrow();
  });
  it('uses pinned models, bounded generation, structured citations and preliminary grading', async () => {
    const fetcher = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body));
      if (body.model === testConfig.GRADING_MODEL)
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    supported: true,
                    missingFacts: [],
                    limitations: 'Human review required',
                  }),
                },
              },
            ],
          }),
        );
      expect(body.max_completion_tokens).toBe(800);
      expect(body.messages[0].content).toContain('untrusted data');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  content: 'Please clarify',
                  disposition: 'clarification',
                  citationIds: [],
                }),
              },
            },
          ],
          model: testConfig.ANSWER_MODEL,
          usage: { prompt_tokens: 5, completion_tokens: 4 },
        }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const ai = openAI({ ...testConfig, OPENAI_API_KEY: 'test-only' });
    const result = await ai.answer('question', 'history', [], {
      name: 'Bot',
      description: '',
      tone: '',
      instructions: '',
      supportEmail: 's@example.com',
      handoffMessage: 'Email us',
      accentColor: '#000000',
      starterQuestions: [],
      allowedOrigins: [],
      autoPublish: false,
    });
    expect(result.disposition).toBe('clarification');
    expect(result.inputTokens).toBe(5);
    expect(await ai.grade('q', 'a', ['fact'], [])).toMatchObject({ supported: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429 })),
    );
    await expect(ai.embed(['q'])).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
  });
  it('never sends disabled email and forwards a stable provider idempotency key when enabled', async () => {
    const payload = {
      to: 'support@example.com',
      replyTo: 'visitor@example.com',
      subject: 'Help',
      text: 'Synthetic test',
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'test-receipt' })));
    vi.stubGlobal('fetch', fetcher);
    await expect(resend(testConfig).send('same-key', payload)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });
    expect(fetcher).not.toHaveBeenCalled();
    const sender = resend({
      ...testConfig,
      EMAIL_DELIVERY_ENABLED: 'true',
      RESEND_API_KEY: 'test-only',
      EMAIL_FROM: 'test@example.com',
    });
    expect(await sender.send('same-key', payload)).toBe('test-receipt');
    expect(fetcher.mock.calls[0]).toBeDefined();
  });
  it('verifies legacy tokens through Supabase Auth and refuses unverified invitation emails', async () => {
    const id = randomUUID();
    const jwt = await new SignJWT({ sub: id, email: 'member@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('test-only-secret'));
    const auth = supabaseAuth({ ...testConfig, SUPABASE_ANON_KEY: 'test-only' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id, email: 'member@example.com', email_confirmed_at: null })),
      ),
    );
    await expect(auth.verify(jwt)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id, email: 'member@example.com', email_confirmed_at: '2026-01-01' })),
      ),
    );
    expect(await auth.verify(jwt)).toEqual({ id, email: 'member@example.com' });
    await expect(auth.verify('not-a-jwt')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('checks asymmetric JWT signature, issuer, audience and expiry before accepting a Supabase identity', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const id = randomUUID();
    const jwk = { ...(await exportJWK(publicKey)), kid: 'fixture-key', alg: 'ES256', use: 'sig' };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: any) =>
          new Response(
            JSON.stringify(
              String(url).includes('jwks')
                ? { keys: [jwk] }
                : { id, email: 'member@example.com', email_confirmed_at: '2026-01-01' },
            ),
          ),
      ),
    );
    const issue = (issuer: string, expiry: string) =>
      new SignJWT({ role: 'authenticated', email: 'member@example.com' })
        .setSubject(id)
        .setProtectedHeader({ alg: 'ES256', kid: 'fixture-key' })
        .setIssuer(issuer)
        .setAudience('authenticated')
        .setExpirationTime(expiry)
        .sign(privateKey);
    const auth = supabaseAuth({ ...testConfig, SUPABASE_ANON_KEY: 'test-only' });
    expect(await auth.verify(await issue(`${testConfig.SUPABASE_URL}/auth/v1`, '5m'))).toMatchObject({ id });
    await expect(auth.verify(await issue('https://wrong.example/auth/v1', '5m'))).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(auth.verify(await issue(`${testConfig.SUPABASE_URL}/auth/v1`, '-1s'))).rejects.toMatchObject(
      { code: 'UNAUTHORIZED' },
    );
  });
});
describe('Hostile extraction and network boundaries', () => {
  function mockResponse(status: number, headers: Record<string, string>, body: string) {
    return vi.spyOn(https, 'request').mockImplementation(((_url: any, options: any, callback: any) => {
      options.lookup('example.com', {}, (_error: unknown, address: string) =>
        expect(address).toBe('8.8.8.8'),
      );
      const request = new EventEmitter() as any;
      request.destroy = (error: Error) => {
        queueMicrotask(() => request.emit('error', error));
      };
      request.end = () => {
        const response = new PassThrough() as any;
        response.statusCode = status;
        response.headers = headers;
        callback(response);
        queueMicrotask(() => response.end(body));
      };
      return request;
    }) as any);
  }
  it('rechecks redirect DNS and never opens a socket to the private destination', async () => {
    const transport = mockResponse(302, { location: 'https://private.example' }, '');
    const resolve = async (host: string) => [
      { address: host === 'private.example' ? '10.0.0.1' : '8.8.8.8', family: 4 },
    ];
    await expect(safeFetch('https://example.com', { resolve })).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('caps response bytes and rejects HTTP failures and compressed bodies', async () => {
    mockResponse(200, { 'content-type': 'text/html' }, 'a'.repeat(100));
    await expect(
      safeFetch('https://example.com', {
        maxBytes: 10,
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      }),
    ).rejects.toMatchObject({ code: 'FETCH_TOO_LARGE' });
    vi.restoreAllMocks();
    mockResponse(500, {}, 'error');
    await expect(
      safeFetch('https://example.com', { resolve: async () => [{ address: '8.8.8.8', family: 4 }] }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    vi.restoreAllMocks();
    mockResponse(200, { 'content-encoding': 'gzip' }, 'compressed');
    await expect(
      safeFetch('https://example.com', { resolve: async () => [{ address: '8.8.8.8', family: 4 }] }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_ENCODING' });
  });
  it('preserves Q&A row references, rejects malformed imports and discloses truncation', () => {
    const parsed = qaCsv('question,answer\n"When?","In 30 days"');
    expect(parsed.sections[0].section).toBe('Q&A row 2');
    expect(() => qaCsv('title,body\nq,a')).toThrow();
    expect(() => plainText('\u0000')).toThrow();
    const large = plainText('# Heading\n' + 'x'.repeat(900000));
    expect(chunkSections(large)).toHaveLength(256);
    expect(large.warnings).toContain('256-chunk extraction limit reached; content is partial');
  });
  it('surfaces missing parser configuration and enforces upload bounds before spawning', async () => {
    await expect(
      pythonParse('pdf', Buffer.from('fake'), {
        ...testConfig,
        PARSER_PYTHON: '/nonexistent-lattice-python',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    await expect(
      pythonParse('pdf', Buffer.alloc(2), { ...testConfig, MAX_UPLOAD_BYTES: 1 }),
    ).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
  });
  it('extracts website tables with URL provenance and discloses partial crawling', async () => {
    const parsed = await crawl(
      'https://docs.example/',
      'website',
      { ...testConfig, MAX_CRAWL_PAGES: 1 },
      async (url) => ({
        url,
        body: Buffer.from(
          '<html><title>Billing</title><main><h1>Plan limits</h1><table><tr><th>Plan</th><th>Days</th></tr><tr><td>Starter</td><td>30</td></tr></table><a href="/next">More details</a></main><script>malicious script</script></html>',
        ),
        contentType: 'text/html',
        status: 200,
      }),
    );
    expect(parsed.sections[0].url).toBe('https://docs.example/');
    expect(parsed.sections[0].text).toContain('Starter |');
    expect(parsed.sections[0].text).not.toContain('malicious script');
    expect(parsed.warnings).toContain('Crawl page/time limit reached; remaining URLs were not imported');
    await expect(
      crawl('https://docs.example/sitemap.xml', 'sitemap', testConfig, async (url) => ({
        url,
        body: Buffer.from('<!DOCTYPE foo><urlset/>'),
        contentType: 'text/xml',
        status: 200,
      })),
    ).rejects.toMatchObject({ code: 'CRAWL_FAILED' });
  });
});
