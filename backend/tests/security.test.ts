import { describe, it, expect } from 'vitest';
import { assertPublicAddress, validateUrl, safeFetch } from '../src/network.js';
import { selectAuthority } from '../src/answers.js';

describe('SSRF and explicit evidence authority', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.1.2',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '224.0.0.1',
    '0.0.0.0',
  ])('rejects non-public address %s', (address) => {
    expect(() => assertPublicAddress(address)).toThrow();
  });
  it('accepts public addresses and rejects credentials, schemes and ports', () => {
    expect(() => assertPublicAddress('8.8.8.8')).not.toThrow();
    for (const url of ['file:///etc/passwd', 'https://user:pass@example.com', 'http://example.com:8080'])
      expect(() => validateUrl(url)).toThrow();
  });
  it('rejects any private DNS answer before a socket can be opened', async () => {
    await expect(
      safeFetch('https://example.com', { resolve: async () => [{ address: '127.0.0.1', family: 4 }] }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });
  it('never lets lower authority contradict selected approved evidence', () => {
    const items = [
      { authority: 'reference', score: 1, id: 'old' },
      { authority: 'approved', score: 0.5, id: 'new' },
    ];
    expect(selectAuthority(items)).toEqual([items[1]]);
  });
});
