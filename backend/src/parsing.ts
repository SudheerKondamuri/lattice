import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { safeFetch, validateUrl } from './network.js';
import type { CrawlPolicy, RagPolicy } from '../../src/contracts/api.js';
export interface Section {
  text: string;
  page?: number;
  section?: string;
  url?: string;
}
export interface Parsed {
  sections: Section[];
  pageCount: number;
  warnings: string[];
  ocrPages: number;
}
export function qaCsv(content: string): Parsed {
  const rows = parse(content, {
    columns: (headers: string[]) => headers.map((h) => h.trim().toLowerCase()),
    bom: true,
    skip_empty_lines: true,
    max_record_size: 20000,
  }) as Record<string, string>[];
  if (!rows.length || rows.length > 2000 || rows.some((r) => !r.question?.trim() || !r.answer?.trim()))
    throw new AppError(
      'INVALID_QA',
      'Q&A CSV needs question and answer headers, nonempty rows, and at most 2000 rows',
    );
  return {
    sections: rows.map((r, i) => ({
      text: `Question: ${r.question}\nAnswer: ${r.answer}`,
      section: `Q&A row ${i + 2}`,
    })),
    pageCount: Math.max(1, Math.ceil(content.length / 6000)),
    warnings: [],
    ocrPages: 0,
  };
}
export function plainText(content: string): Parsed {
  if (!content.trim() || content.includes('\u0000'))
    throw new AppError('EMPTY_EXTRACTION', 'No usable UTF-8 text was extracted');
  return {
    sections: content.split(/(?=^#{1,4} )/m).map((text) => ({ text, section: text.match(/^#+ (.+)/)?.[1] })),
    pageCount: Math.max(1, Math.ceil(content.length / 6000)),
    warnings: [],
    ocrPages: 0,
  };
}
export async function pythonParse(kind: string, bytes: Buffer, config: Config): Promise<Parsed> {
  if (bytes.length > config.MAX_UPLOAD_BYTES)
    throw new AppError('UPLOAD_TOO_LARGE', 'Upload exceeds limit', 413);
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.PARSER_PYTHON,
      [fileURLToPath(new URL('../parser/parse.py', import.meta.url))],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          OMP_NUM_THREADS: '1',
          OPENBLAS_NUM_THREADS: '1',
          PARSER_ARTIFACTS_PATH: config.PARSER_ARTIFACTS_PATH,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
        },
      },
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new AppError('PARSER_TIMEOUT', 'Extraction timed out; use a smaller document', 422));
    }, config.PARSER_TIMEOUT_MS);
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 3_000_000) {
        child.kill('SIGKILL');
        reject(new AppError('EXTRACTION_LIMIT', 'Extracted document exceeds output limit', 422));
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(
        new AppError(
          'CONFIGURATION_ERROR',
          'Python parser is unavailable; install backend/parser requirements',
          503,
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new AppError(
            'PARSER_FAILED',
            'Parser failed. Verify parser models/dependencies or upload a smaller readable file.',
            422,
          ),
        );
        return;
      }
      try {
        resolve(
          z
            .object({
              sections: z.array(
                z.object({ text: z.string(), page: z.number().optional(), section: z.string().optional() }),
              ),
              pageCount: z.number().int().positive(),
              warnings: z.array(z.string()),
              ocrPages: z.number().int().nonnegative(),
            })
            .parse(JSON.parse(Buffer.concat(chunks).toString())),
        );
      } catch {
        reject(new AppError('PARSER_FAILED', 'Invalid parser output', 422));
      }
    });
    child.stdin.end(
      JSON.stringify({
        kind,
        base64: bytes.toString('base64'),
        maxPages: config.MAX_PDF_PAGES,
        maxOcrPages: config.MAX_OCR_PAGES,
      }),
    );
  });
}
export async function crawl(
  input: string,
  kind: string,
  config: Config,
  fetchPage: typeof safeFetch = safeFetch,
  policy?: CrawlPolicy,
): Promise<Parsed> {
  const root = validateUrl(input);
  const visited = new Set<string>();
  const allowed = (value: string) => {
    const u = validateUrl(value);
    return u.origin === root.origin && !policy?.excludePaths.some((path) => u.pathname.startsWith(path));
  };
  const queue = policy?.selectedUrls?.length ? policy.selectedUrls.filter(allowed) : [root.href];
  const maxPages = Math.min(config.MAX_CRAWL_PAGES, policy?.maxPages ?? config.MAX_CRAWL_PAGES);
  const sections: Section[] = [];
  const warnings: string[] = [];
  let bytes = 0;
  let pages = 0;
  const deadline = Date.now() + 90000;
  while (queue.length && visited.size < maxPages && Date.now() < deadline) {
    const url = queue.shift()!;
    if (!allowed(url)) continue;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const response = await fetchPage(url, {
        maxBytes: 2_000_000,
        timeoutMs: Math.min(15000, Math.max(1, deadline - Date.now())),
      });
      if (new URL(response.url).origin !== root.origin)
        throw new AppError('CRAWL_ORIGIN', 'Redirect left the selected website origin');
      if (
        response.contentType.includes('xml') ||
        response.body.toString('utf8', 0, 200).includes('<urlset') ||
        response.body.toString('utf8', 0, 200).includes('<sitemapindex')
      ) {
        if (/<!DOCTYPE|<!ENTITY/i.test(response.body.toString()))
          throw new AppError('UNSAFE_XML', 'XML entities and DTDs are not supported');
        const xml = new XMLParser({ processEntities: false, ignoreAttributes: true }).parse(
          response.body.toString(),
        );
        const entries = xml.urlset?.url ?? xml.sitemapindex?.sitemap ?? [];
        for (const item of Array.isArray(entries) ? entries : [entries])
          if (typeof item.loc === 'string') {
            const next = validateUrl(item.loc);
            if (
              next.origin === root.origin &&
              !visited.has(next.href) &&
              queue.length < config.MAX_CRAWL_PAGES * 2
            )
              queue.push(next.href);
          }
        continue;
      }
      if (!response.contentType.includes('html') && !response.contentType.startsWith('text/'))
        throw new AppError('UNSUPPORTED_FORMAT', 'Website URL did not return HTML/text');
      const $ = load(response.body.toString());
      $('script,style,noscript,nav,footer,header,iframe,form,svg').remove();
      const main = $('main,article').first();
      const container = main.length ? main : $('body');
      container.find('br').replaceWith('\n');
      container.find('p,div,li,tr,h1,h2,h3,h4,pre').append('\n');
      container.find('td,th').append(' | ');
      const text = container
        .text()
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
      if (text.length < 20)
        throw new AppError(
          'EMPTY_EXTRACTION',
          'Page has little usable text; JavaScript-only pages require a text export',
        );
      bytes += text.length;
      if (bytes > 1_000_000) {
        warnings.push('Total extracted-text limit reached; some pages were omitted');
        break;
      }
      sections.push({ text, section: $('title').text().slice(0, 200), url: response.url });
      pages++;
      if (kind === 'website')
        container.find('a[href]').each((_, a) => {
          try {
            const next = validateUrl(new URL($(a).attr('href')!, url).href);
            if (
              next.origin === root.origin &&
              next.pathname.startsWith(root.pathname.replace(/[^/]*$/, '')) &&
              !next.search &&
              !visited.has(next.href) &&
              queue.length < config.MAX_CRAWL_PAGES * 2
            )
              queue.push(next.href);
          } catch {
            /* Ignore unsupported links. */
          }
        });
    } catch (error) {
      warnings.push(`${url}: ${error instanceof AppError ? error.message : 'Page fetch failed'}`);
    }
  }
  if (queue.length) warnings.push('Crawl page/time limit reached; remaining URLs were not imported');
  if (!sections.length) throw new AppError('CRAWL_FAILED', warnings[0] ?? 'No readable pages found', 422);
  return { sections, pageCount: pages, warnings, ocrPages: 0 };
}
export function chunkSections(parsed: Parsed, policy?: RagPolicy) {
  const chunks: { content: string; reference: Omit<Section, 'text'> }[] = [];
  for (const section of parsed.sections) {
    const { text, ...reference } = section;
    const size = Math.min(2400, policy?.chunkSizeChars ?? 2400);
    const overlap = Math.min(size - 1, policy?.chunkOverlapChars ?? 400);
    for (let offset = 0; offset < text.length; offset += size - overlap) {
      if (chunks.length >= 256) {
        parsed.warnings.push('256-chunk extraction limit reached; content is partial');
        return chunks;
      }
      const content = text.slice(offset, offset + size).trim();
      if (content) chunks.push({ content, reference });
    }
  }
  if (!chunks.length) throw new AppError('EMPTY_EXTRACTION', 'No usable passages were extracted', 422);
  return chunks;
}
