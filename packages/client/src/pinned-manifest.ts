import { validateManifest } from '../../protocol/src/manifest';
import { readBytes } from './bytes';

/** An index is only an accelerator for a requested signed revision, never its authority. */
export async function indexedPinnedManifest(id: string, request: typeof fetch = fetch) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid pinned revision');
  const response = await request(`/api/manifest?reference=${id}`, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return null;
  const value = JSON.parse(new TextDecoder().decode(await readBytes(response, 70000)));
  const { manifest } = await validateManifest(value.manifest);
  if (manifest.id !== id) throw new Error('Index returned a different pinned revision');
  return manifest;
}
