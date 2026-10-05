type BrowserInfo = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean; brands?: { brand: string; version?: string }[] };
  brave?: { isBrave?: () => Promise<boolean> };
};

/** Human-readable display metadata, not a device fingerprint or authorization identity. */
export function browserConnectionName(
  clientPubkey: string,
  browser: BrowserInfo = typeof navigator === 'undefined' ? {} : navigator,
) {
  if (!/^[a-f0-9]{64}$/.test(clientPubkey)) throw new Error('Invalid client public key.');
  const ua = browser.userAgent ?? '',
    brands = browser.userAgentData?.brands ?? [];
  const brand = (name: string) => brands.some((b) => b.brand.toLowerCase().includes(name));
  const name =
    /Edg(?:e|A|iOS)?\//.test(ua) || brand('edge')
      ? 'Edge'
      : /OPR\/|Opera|OPiOS/.test(ua) || brand('opera')
        ? 'Opera'
        : /Firefox\/|FxiOS\//.test(ua) || brand('firefox')
          ? 'Firefox'
          : brand('brave') || typeof browser.brave?.isBrave === 'function'
            ? 'Brave'
            : /SamsungBrowser\//.test(ua)
              ? 'Samsung Internet'
              : /DuckDuckGo|Ddg\//.test(ua)
                ? 'DuckDuckGo'
                : /Chrome\/|CriOS\//.test(ua) || brand('chrome') || brand('chromium')
                  ? 'Chrome'
                  : /Safari\//.test(ua)
                    ? 'Safari'
                    : 'Browser';
  const ipad =
    /iPad/.test(ua) || (browser.platform === 'MacIntel' && (browser.maxTouchPoints ?? 0) > 1);
  const format =
    ipad || /Tablet|PlayBook|Silk\//.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
      ? 'Tablet'
      : browser.userAgentData?.mobile || /Mobile|iPhone|iPod/.test(ua)
        ? 'Mobile'
        : 'Desktop';
  // The suffix is public and stable for this signer connection, including reconnects.
  return `napplet.soy · ${name} · ${format} · ${clientPubkey.slice(0, 8)}`;
}
