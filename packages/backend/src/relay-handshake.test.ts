import { expect, test } from 'bun:test';

test.each(['query', 'publish', 'close', 'timeout'])(
  'a failed relay handshake and late timeout cannot terminate the HTTP server during %s',
  async (operation) => {
    const child = Bun.spawn(
      [
        process.execPath,
        new URL('./relay-handshake.fixture.ts', import.meta.url).pathname,
        operation,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const stderr = new Response(child.stderr).text();
    const deadline = setTimeout(() => child.kill(), 8000);
    try {
      const reader = child.stdout.getReader();
      const first = await reader.read();
      reader.releaseLock();
      const url = new TextDecoder().decode(first.value).trim();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const response = await fetch(new URL(operation, url));
      expect(response.status).toBe(200);
      const result = await response.json();
      if (operation === 'query') expect(result.ids).toEqual([result.expected]);
      if (operation === 'publish') expect(result.accepted).toEqual([result.expected]);
      if (operation === 'close') expect(result.errors).toEqual(['Fixture TLS handshake failed']);
      if (operation === 'timeout')
        expect(result.errors).toEqual(['Opening handshake has timed out']);
      await Bun.sleep(50);
      // This was a process exit/502, not merely a failed individual relay read.
      const health = await fetch(new URL('health', url));
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ status: 'ok', timeoutsDisabled: 1 });
      await fetch(new URL('stop', url));
      expect(await child.exited).toBe(0);
      expect(await stderr).toBe('');
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null) child.kill();
      await child.exited;
    }
  },
  10000,
);
