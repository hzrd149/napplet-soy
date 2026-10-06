import { test, expect } from 'bun:test';
import { browserConnectionName } from '../../../apps/web/src/lib/connection-name';
const key = '7c91ab42' + '0'.repeat(56);
test('signer labels distinguish browser, device format and independent connections', () => {
  const samples = [
    [{ userAgent: 'Mozilla Chrome/140.0 Safari/537.36' }, 'Chrome · Desktop'],
    [{ userAgent: 'Mozilla Chrome/140.0 Safari/537.36 Edg/140.0' }, 'Edge · Desktop'],
    [{ userAgent: 'Mozilla Firefox/143.0' }, 'Firefox · Desktop'],
    [{ userAgent: 'iPhone Mobile/15E148 Version/26.0 Safari/604.1' }, 'Safari · Mobile'],
    [{ userAgent: 'iPhone FxiOS/143.0 Mobile/15E148 Safari/604.1' }, 'Firefox · Mobile'],
    [{ userAgent: 'Android 15 Chrome/140.0 Mobile Safari/537.36' }, 'Chrome · Mobile'],
    [{ userAgent: 'Android 15 Chrome/140.0 Safari/537.36' }, 'Chrome · Tablet'],
    [
      { userAgent: 'Macintosh Version/26.0 Safari/605.1', platform: 'MacIntel', maxTouchPoints: 5 },
      'Safari · Tablet',
    ],
    [{ userAgentData: { brands: [{ brand: 'Brave' }], mobile: false } }, 'Brave · Desktop'],
    [
      { userAgent: 'Chrome/140.0 Safari/537.36', brave: { isBrave: async () => true } },
      'Brave · Desktop',
    ],
    [{}, 'Browser · Desktop'],
  ] as const;
  for (const [agent, expected] of samples)
    expect(browserConnectionName(key, agent as any)).toBe(`napplet.soy · ${expected} · 7c91ab42`);
  expect(browserConnectionName(key, {})).toBe(browserConnectionName(key, {}));
  expect(browserConnectionName(key, {})).not.toBe(browserConnectionName('a'.repeat(64), {}));
  expect(() => browserConnectionName('bad', {})).toThrow();
});
