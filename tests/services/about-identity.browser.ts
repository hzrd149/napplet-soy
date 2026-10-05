import { chromium, expect, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getPublicKey, nip19 } from 'nostr-tools';
import { decrypt } from 'nostr-tools/nip49';

async function verify() {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-about-key-'));
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '0',
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_SOURCE_GITHUB_URL: 'javascript:alert(1)',
      SPACE_SOURCE_GITWORKSHOP_URL: 'https://user:secret@gitworkshop.dev/private',
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const reader = server.stdout.getReader();
  let output = '',
    origin = '';
  while (!origin) {
    const part = await reader.read();
    if (part.done) throw Error('Server exited');
    output += new TextDecoder().decode(part.value);
    origin = /listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? '';
  }
  reader.releaseLock();
  void (async () => {
    for await (const _ of server.stdout) {
    }
  })();
  origin = new URL(origin).origin;
  const browser = await chromium.launch();
  try {
    const nojs = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const staticPage = await nojs.newPage();
    expect((await staticPage.goto(origin + '/about'))?.status()).toBe(200);
    await browserExpect(staticPage.locator('h1')).toContainText('Open possibilities');
    await browserExpect(staticPage.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'About — napplet.soy',
    );
    await browserExpect(
      staticPage.getByRole('contentinfo').getByRole('link', { name: 'About', exact: true }),
    ).toBeVisible();
    expect(await staticPage.locator('.about-resources > a').count()).toBe(8);
    expect(await staticPage.locator('.about-repositories').count()).toBe(0);
    expect(await staticPage.content()).not.toContain('user:secret');
    for (const width of [320, 390, 1365]) {
      await staticPage.setViewportSize({ width, height: 900 });
      expect(
        await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    }
    await mkdir('.local/about-identity-check', { recursive: true });
    await staticPage.screenshot({
      path: '.local/about-identity-check/about-desktop.png',
      fullPage: true,
    });
    await staticPage.setViewportSize({ width: 390, height: 844 });
    await staticPage.screenshot({
      path: '.local/about-identity-check/about-mobile.png',
      fullPage: true,
    });
    await nojs.close();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(10000);
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (req) => requests.push(req.url() + ' ' + (req.postData() ?? '')));
    await page.routeWebSocket('wss://**', (route) => route.close());
    await page.goto(origin + '/about');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Create identity', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Generate new identity' })).toBeDisabled();
    await page.getByLabel('I understand that I must preserve my private key.').check();
    await page.getByRole('button', { name: 'Generate new identity' }).click();
    const npub = await page.locator('.identity-menu .public-key').textContent();
    const decoded = nip19.decode(npub!);
    if (decoded.type !== 'npub') throw Error('Expected public identity');
    const pubkey = decoded.data;
    const continueButton = page.getByRole('button', { name: 'Continue with this identity' });
    await browserExpect(continueButton).toBeDisabled();
    const phrase = 'test phrase kept separate';
    await page.getByLabel('Recovery passphrase', { exact: true }).fill(phrase);
    await page.getByLabel('Confirm recovery passphrase', { exact: true }).fill('does not match');
    await browserExpect(
      page.getByRole('button', { name: 'Prepare encrypted backup' }),
    ).toBeDisabled();
    await page.getByLabel('Confirm recovery passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Prepare encrypted backup' }).click();
    const downloadButton = page.getByRole('link', { name: 'Download recovery file' });
    await browserExpect(downloadButton).toBeVisible({ timeout: 15000 });
    await browserExpect(continueButton).toBeDisabled();
    const firstDownload = page.waitForEvent('download');
    await downloadButton.click();
    const file = await firstDownload;
    const backup = await Bun.file((await file.path())!).text();
    const key = decrypt(backup.trim(), phrase);
    expect(getPublicKey(key)).toBe(pubkey);
    await browserExpect(continueButton).toBeDisabled();
    await page.getByLabel('I saved my recovery file or text and its passphrase.').check();
    await continueButton.click();
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    const connected = page.getByRole('button', { name: pubkey.slice(0, 6) + '…', exact: true });
    await connected.click();
    await page.getByRole('button', { name: 'Back up private key', exact: true }).click();
    const phrase2 = 'second backup test passphrase';
    await page.getByLabel('Recovery passphrase', { exact: true }).fill(phrase2);
    await page.getByLabel('Confirm recovery passphrase', { exact: true }).fill(phrase2);
    await page.getByRole('button', { name: 'Prepare encrypted backup' }).click();
    const secondDownload = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download recovery file' }).click();
    const secondFile = await secondDownload;
    const backup2 = await Bun.file((await secondFile.path())!).text();
    expect(getPublicKey(decrypt(backup2.trim(), phrase2))).toBe(pubkey);
    expect(backup2).not.toBe(backup);
    const secretHex = Buffer.from(key).toString('hex');
    const storage = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    );
    expect(
      storage.includes(secretHex) || storage.includes(phrase) || storage.includes('ncryptsec'),
    ).toBe(false);
    expect(
      requests.some(
        (request) =>
          request.includes(secretHex) ||
          request.includes(phrase) ||
          request.includes(backup.trim()),
      ),
    ).toBe(false);
    key.fill(0);
    // A canceled generated draft cannot replace the connected account.
    await page.getByRole('button', { name: 'Create identity', exact: true }).click();
    await page.getByLabel('I understand that I must preserve my private key.').check();
    await page.getByRole('button', { name: 'Generate new identity' }).click();
    await page.getByLabel('Recovery passphrase', { exact: true }).fill(phrase);
    await page.getByLabel('Confirm recovery passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Prepare encrypted backup' }).click();
    await page.keyboard.press('Escape');
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    await browserExpect(connected).toBeVisible();
    // Refresh forgets the account; the downloaded file restores that same public key.
    await page.reload();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Private key', exact: true }).click();
    await page.getByLabel('Recovery file', { exact: true }).setInputFiles({
      name: 'backup.ncryptsec',
      mimeType: 'text/plain',
      buffer: Buffer.from(backup),
    });
    await page.getByLabel('I understand the risk').check();
    await page.getByLabel('Recovery passphrase', { exact: true }).fill('wrong passphrase');
    await page.getByRole('button', { name: 'Use key for this session' }).click();
    await browserExpect(page.getByRole('alert')).toContainText('valid nsec', { timeout: 15000 });
    await browserExpect(page.locator('.connect-button')).toHaveText('Connect');
    await page.getByLabel('Recovery file', { exact: true }).setInputFiles({
      name: 'backup.ncryptsec',
      mimeType: 'text/plain',
      buffer: Buffer.from(backup),
    });
    await page.getByLabel('Recovery passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Use key for this session' }).click();
    await browserExpect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });
    await connected.click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await browserExpect(
      page.getByRole('button', { name: 'Back up private key', exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}
await verify();
console.log('About and browser recovery checks passed.');
