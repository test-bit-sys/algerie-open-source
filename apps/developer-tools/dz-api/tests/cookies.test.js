import { describe, it, expect } from 'vitest';
import { CookieJar, parseSetCookie, parseCookieDate, domainMatch, pathMatch, defaultPath } from '../src/core/cookies.js';

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

describe('parseSetCookie', () => {
  it('parses name, value and attributes', () => {
    const c = parseSetCookie('sid=abc=def; Path=/app; Domain=.Example.COM; Secure; HttpOnly; SameSite=lax; Expires=Wed, 21 Oct 2026 07:28:00 GMT', NOW);
    expect(c).toMatchObject({
      name: 'sid',
      value: 'abc=def',
      path: '/app',
      domain: 'example.com',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expires: Date.UTC(2026, 9, 21, 7, 28, 0),
    });
  });

  it('handles odd input', () => {
    expect(parseSetCookie('')).toBeNull();
    expect(parseSetCookie(' ; Path=/')).toBeNull();
    expect(parseSetCookie('justavalue')).toMatchObject({ name: '', value: 'justavalue' });
    expect(parseSetCookie('a=1; Path=relative').path).toBeNull();
    expect(parseSetCookie('a=1; SameSite=bogus').sameSite).toBeNull();
    expect(parseSetCookie(' a = 1 ;secure').secure).toBe(true);
    expect(parseSetCookie('a=1; Expires=garbage').expires).toBeNull();
  });

  it('gives Max-Age precedence over Expires regardless of order', () => {
    expect(parseSetCookie('a=1; Max-Age=60; Expires=Wed, 21 Oct 2015 07:28:00 GMT', NOW).expires).toBe(NOW + 60000);
    expect(parseSetCookie('a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Max-Age=60', NOW).expires).toBe(NOW + 60000);
    expect(parseSetCookie('a=1; Max-Age=0', NOW).expires).toBe(0);
    expect(parseSetCookie('a=1; Max-Age=-5', NOW).expires).toBe(0);
    expect(parseSetCookie('a=1; Max-Age=abc', NOW).expires).toBeNull();
  });

  it('parses the common date formats', () => {
    const expected = Date.UTC(1994, 10, 6, 8, 49, 37);
    expect(parseCookieDate('Sun, 06 Nov 1994 08:49:37 GMT')).toBe(expected);
    expect(parseCookieDate('Sunday, 06-Nov-94 08:49:37 GMT')).toBe(expected);
    expect(parseCookieDate('Sun Nov  6 08:49:37 1994')).toBe(expected);
    expect(parseCookieDate('Sun, 06-Nov-1994 08:49:37 GMT')).toBe(expected);
    expect(parseCookieDate('06 Nov 2030 08:49:37')).toBe(Date.UTC(2030, 10, 6, 8, 49, 37));
    expect(parseCookieDate('Thu, 01 Jan 2037 00:00:00 GMT')).toBe(Date.UTC(2037, 0, 1));
    expect(parseCookieDate('Sat, 31 Feb 2026 00:00:00 GMT')).toBeNull();
    expect(parseCookieDate('nonsense')).toBeNull();
  });
});

describe('matching helpers', () => {
  it('domain-matches', () => {
    expect(domainMatch('example.com', 'example.com')).toBe(true);
    expect(domainMatch('www.example.com', 'example.com')).toBe(true);
    expect(domainMatch('badexample.com', 'example.com')).toBe(false);
    expect(domainMatch('example.com', 'www.example.com')).toBe(false);
    expect(domainMatch('1.2.3.4', '2.3.4')).toBe(false);
  });

  it('path-matches and computes default paths', () => {
    expect(pathMatch('/a/b', '/a')).toBe(true);
    expect(pathMatch('/a/', '/a/')).toBe(true);
    expect(pathMatch('/a/b', '/a/')).toBe(true);
    expect(pathMatch('/ab', '/a')).toBe(false);
    expect(pathMatch('/', '/a')).toBe(false);
    expect(defaultPath('/a/b/c')).toBe('/a/b');
    expect(defaultPath('/a')).toBe('/');
    expect(defaultPath('')).toBe('/');
  });
});

describe('CookieJar', () => {
  it('stores host-only cookies for the exact host only', () => {
    const jar = new CookieJar();
    const { accepted } = jar.setFromResponse('https://example.com/login', ['h=1; Path=/'], NOW);
    expect(accepted[0]).toMatchObject({ domain: 'example.com', hostOnly: true });
    expect(jar.cookieHeader('https://example.com/', NOW)).toBe('h=1');
    expect(jar.cookieHeader('https://www.example.com/', NOW)).toBe('');
  });

  it('stores domain cookies for subdomains', () => {
    const jar = new CookieJar();
    jar.setFromResponse('https://api.example.com/', ['d=1; Domain=example.com; Path=/', 'e=2; Domain=.api.example.com; Path=/'], NOW);
    expect(jar.cookieHeader('https://example.com/', NOW)).toBe('d=1');
    expect(jar.cookieHeader('https://x.api.example.com/', NOW)).toBe('d=1; e=2');
    expect(jar.cookieHeader('https://other.com/', NOW)).toBe('');
    expect(jar.list(NOW).every((c) => c.hostOnly === false)).toBe(true);
  });

  it('a Domain equal to the host makes a domain cookie, single-label hosts stay host-only', () => {
    const jar = new CookieJar();
    jar.setFromResponse('http://example.com/', ['a=1; Domain=example.com'], NOW);
    expect(jar.cookieHeader('http://sub.example.com/', NOW)).toBe('a=1');
    jar.setFromResponse('http://localhost:3000/', ['l=1; Domain=localhost'], NOW);
    expect(jar.list(NOW).find((c) => c.name === 'l')).toMatchObject({ domain: 'localhost', hostOnly: true });
  });

  it('rejects public-suffix-ish and foreign domains', () => {
    const jar = new CookieJar();
    const { accepted, rejected } = jar.setFromResponse(
      'https://www.example.com/',
      ['a=1; Domain=.com', 'b=2; Domain=other.com', 'c=3; Domain=sub.www.example.com', 'ok=1; Domain=www.example.com'],
      NOW,
    );
    expect(accepted.map((c) => c.name)).toEqual(['ok']);
    expect(rejected.map((r) => r.reason)).toEqual([
      'Domain "com" is too broad',
      'Domain "other.com" does not match host "www.example.com"',
      'Domain "sub.www.example.com" does not match host "www.example.com"',
    ]);
  });

  it('matches paths and uses the default path', () => {
    const jar = new CookieJar();
    jar.setFromResponse('http://example.com/docs/page', ['def=1', 'root=1; Path=/', 'api=1; Path=/api'], NOW);
    expect(jar.list(NOW).find((c) => c.name === 'def').path).toBe('/docs');
    expect(jar.cookieHeader('http://example.com/docs/other', NOW)).toBe('def=1; root=1');
    expect(jar.cookieHeader('http://example.com/api/v1', NOW)).toBe('api=1; root=1');
    expect(jar.cookieHeader('http://example.com/apiary', NOW)).toBe('root=1');
  });

  it('sends Secure cookies only over https and refuses to set them over http', () => {
    const jar = new CookieJar();
    jar.setFromResponse('https://example.com/', ['s=1; Secure', 'p=1'], NOW);
    expect(jar.cookieHeader('https://example.com/', NOW)).toBe('s=1; p=1');
    expect(jar.cookieHeader('http://example.com/', NOW)).toBe('p=1');
    const { rejected } = jar.setFromResponse('http://example.com/', ['t=1; Secure'], NOW);
    expect(rejected.length).toBe(1);
  });

  it('enforces cookie name prefixes', () => {
    const jar = new CookieJar();
    const { accepted } = jar.setFromResponse(
      'https://www.example.com/',
      ['__Secure-a=1', '__Secure-b=1; Secure', '__Host-c=1; Secure; Path=/', '__Host-d=1; Secure; Path=/; Domain=example.com', '__Host-e=1; Secure; Path=/x'],
      NOW,
    );
    expect(accepted.map((c) => c.name)).toEqual(['__Secure-b', '__Host-c']);
  });

  it('expires cookies via Expires and Max-Age and deletes on an expired Set-Cookie', () => {
    const jar = new CookieJar();
    jar.setFromResponse('http://example.com/', ['a=1; Max-Age=10', 'b=2; Expires=Thu, 01 Jan 2099 00:00:00 GMT', 'c=3', 'old=1; Expires=Thu, 01 Jan 1998 00:00:00 GMT'], NOW);
    expect(jar.cookieHeader('http://example.com/', NOW)).toBe('a=1; b=2; c=3');
    expect(jar.cookieHeader('http://example.com/', NOW + 11000)).toBe('b=2; c=3');
    expect(jar.list(NOW + 11000).map((c) => c.name)).toEqual(['b', 'c']);
    jar.setFromResponse('http://example.com/', ['c=; Max-Age=0'], NOW + 12000);
    expect(jar.cookieHeader('http://example.com/', NOW + 12000)).toBe('b=2');
  });

  it('orders by path length, then creation time, and keeps creation time on replace', () => {
    const jar = new CookieJar();
    jar.setFromResponse('http://example.com/', ['first=1; Path=/'], NOW);
    jar.setFromResponse('http://example.com/', ['second=1; Path=/'], NOW + 1);
    jar.setFromResponse('http://example.com/', ['deep=1; Path=/a/b'], NOW + 2);
    jar.setFromResponse('http://example.com/', ['mid=1; Path=/a'], NOW + 3);
    jar.setFromResponse('http://example.com/', ['first=updated; Path=/'], NOW + 4);
    expect(jar.cookieHeader('http://example.com/a/b/c', NOW + 5)).toBe('deep=1; mid=1; first=updated; second=1');
    expect(jar.list(NOW).find((c) => c.name === 'first').createdAt).toBe(NOW);
  });

  it('keeps SameSite and HttpOnly as metadata', () => {
    const jar = new CookieJar();
    jar.setFromResponse('https://example.com/', ['a=1; SameSite=Strict; HttpOnly'], NOW);
    expect(jar.list(NOW)[0]).toMatchObject({ sameSite: 'Strict', httpOnly: true });
    expect(jar.cookieHeader('https://example.com/', NOW)).toBe('a=1');
  });

  it('supports manual edits, removal and domain listing', () => {
    const jar = new CookieJar();
    jar.set({ name: 'm', value: '1', domain: '.B.test', path: '/' }, NOW);
    jar.set({ name: 'n', value: '2', domain: 'a.test', hostOnly: true }, NOW);
    jar.set({ name: 'o', value: '3', domain: 'a.test', path: '/x' }, NOW);
    expect(jar.domains()).toEqual(['a.test', 'b.test']);
    expect(jar.cookieHeader('http://sub.b.test/', NOW)).toBe('m=1');
    expect(jar.remove('a.test', '/', 'n')).toBe(true);
    expect(jar.remove('a.test', '/', 'n')).toBe(false);
    expect(jar.clearDomain('a.test')).toBe(1);
    expect(jar.domains()).toEqual(['b.test']);
    jar.clear();
    expect(jar.size).toBe(0);
    expect(() => jar.set({ name: 'x', value: '1' })).toThrow();
  });

  it('round-trips through JSON', () => {
    const jar = new CookieJar();
    jar.setFromResponse('https://www.example.com/a/', ['a=1; Secure; HttpOnly; SameSite=None', 'b=2; Domain=example.com; Path=/; Max-Age=3600'], NOW);
    const text = JSON.stringify(jar);
    const copy = CookieJar.fromJSON(text);
    expect(copy.list(NOW)).toEqual(jar.list(NOW));
    expect(copy.cookieHeader('https://www.example.com/a/b', NOW)).toBe(jar.cookieHeader('https://www.example.com/a/b', NOW));
    expect(CookieJar.fromJSON({ cookies: JSON.parse(text) }).size).toBe(2);
    expect(CookieJar.fromJSON([{ name: 'bad' }, ...JSON.parse(text)]).size).toBe(2);
    expect(new CookieJar(JSON.parse(text)).size).toBe(2);
  });

  it('prunes expired cookies', () => {
    const jar = new CookieJar();
    jar.setFromResponse('http://example.com/', ['a=1; Max-Age=1', 'b=1'], NOW);
    expect(jar.prune(NOW + 2000)).toBe(1);
    expect(jar.size).toBe(1);
  });
});
