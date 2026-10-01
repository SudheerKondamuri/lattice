import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors.js';
export function assertPublicAddress(address: string) {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.process(address);
  } catch {
    throw new AppError('UNSAFE_URL', 'Invalid resolved address');
  }
  if (parsed.range() !== 'unicast')
    throw new AppError('UNSAFE_URL', 'Private, special-use and reserved networks are prohibited');
}
export function validateUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('UNSAFE_URL', 'A valid public HTTP(S) URL is required');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.endsWith('.local') ||
    url.hostname === 'localhost'
  )
    throw new AppError('UNSAFE_URL', 'Only public HTTP(S) URLs on standard ports are allowed');
  url.hash = '';
  return url;
}
export interface FetchResult {
  url: string;
  body: Buffer;
  contentType: string;
  status: number;
}
type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export async function safeFetch(
  input: string,
  options: { maxBytes?: number; timeoutMs?: number; resolve?: Resolver } = {},
): Promise<FetchResult> {
  const deadline = Date.now() + (options.timeoutMs ?? 15000);
  let url = validateUrl(input);
  const resolve = options.resolve ?? ((host) => lookup(host, { all: true, verbatim: true }));
  for (let redirect = 0; redirect <= 4; redirect++) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AppError('FETCH_TIMEOUT', 'Website fetch timed out', 502);
    let timer: NodeJS.Timeout | undefined;
    const addresses = await Promise.race([
      resolve(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AppError('FETCH_TIMEOUT', 'DNS lookup timed out', 502)),
          remaining,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length) throw new AppError('UNSAFE_URL', 'No public DNS address');
    addresses.forEach((item) => assertPublicAddress(item.address));
    const pinned = addresses[0];
    const result = await new Promise<FetchResult & { location?: string }>((resolveResult, reject) => {
      const request = (url.protocol === 'https:' ? https : http).request(
        url,
        {
          method: 'GET',
          headers: { 'User-Agent': 'LatticeKnowledgeBot/1.0', 'Accept-Encoding': 'identity' },
          // Pin the validated address for this socket; no second DNS resolution (rebinding).
          lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
          agent: false,
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && response.headers.location) {
            response.destroy();
            resolveResult({
              url: url.href,
              body: Buffer.alloc(0),
              contentType: '',
              status,
              location: response.headers.location,
            });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > (options.maxBytes ?? 2_000_000)) {
              request.destroy(new AppError('FETCH_TOO_LARGE', 'Website page exceeds extraction limit', 413));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            if (status < 200 || status >= 300)
              reject(new AppError('FETCH_FAILED', `Website returned HTTP ${status}`, 502));
            else if (
              response.headers['content-encoding'] &&
              response.headers['content-encoding'] !== 'identity'
            )
              reject(new AppError('UNSUPPORTED_ENCODING', 'Compressed responses are not accepted'));
            else
              resolveResult({
                url: url.href,
                body: Buffer.concat(chunks),
                status,
                contentType: response.headers['content-type'] ?? '',
              });
          });
        },
      );
      request.on('error', (error) =>
        reject(
          error instanceof AppError
            ? error
            : new AppError('FETCH_FAILED', 'Website connection failed or timed out', 502),
        ),
      );
      request.end();
    });
    if (!result.location) return result;
    url = validateUrl(new URL(result.location, url).href);
  }
  throw new AppError('REDIRECT_LIMIT', 'Website exceeded four redirects');
}
