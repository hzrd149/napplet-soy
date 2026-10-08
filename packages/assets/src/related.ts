import type { AssetLock } from './index';

/** BUD-10 discovery metadata; NAP-RESOURCE's pinned URI syntax stays separate. */
export async function relatedAssetHtml(html: Uint8Array, lock: AssetLock) {
  const assets = [
    ...new Map(
      [...lock.assets]
        .filter((asset) => asset.storage === 'external')
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((asset) => [asset.hash, asset] as const),
    ).values(),
  ].sort((a, b) => a.hash.localeCompare(b.hash));
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const links = assets
    .map((asset) => {
      const extension = asset.path.split('.').pop() || 'bin';
      return `<link rel="related" data-soyli-related href="blossom:${asset.hash}.${extension}?sz=${asset.bytes}" type="${escape(asset.mime)}">`;
    })
    .join('');
  let head = false;
  let removed = false;
  const response = new HTMLRewriter()
    .on('link[data-soyli-related]', {
      element(element) {
        removed = true;
        element.remove();
      },
    })
    .on('head', {
      element(element) {
        head = true;
        element.append(links, { html: true });
      },
    })
    .transform(new Response(new Uint8Array(html)));
  const output = new Uint8Array(await response.arrayBuffer());
  // Keep existing artifacts byte-for-byte when they need no metadata.
  if (!links && !removed) return new Uint8Array(html);
  if (head || !links) return output;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(output);
  // HTML source can omit its head. Insert after the doctype so quirks mode is unchanged.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(text);
  const offset = doctype?.[0].length ?? 0;
  return new TextEncoder().encode(
    `${text.slice(0, offset)}<head>${links}</head>${text.slice(offset)}`,
  );
}
