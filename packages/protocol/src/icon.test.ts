import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { sha256 } from './index';
import { iconDimensions, iconMime, verifyIconBytes } from './icon';

const image = () =>
  sharp({
    create: {
      width: 21,
      height: 13,
      channels: 4,
      background: { r: 20, g: 60, b: 120, alpha: 0.4 },
    },
  });

test('PNG, JPEG and all common WebP headers bound dimensions before decoding', async () => {
  for (const bytes of [
    await image().png().toBuffer(),
    await image().jpeg().toBuffer(),
    await image().withMetadata({ orientation: 6 }).jpeg().toBuffer(),
    await image().removeAlpha().webp().toBuffer(),
    await image().webp().toBuffer(),
    await image().webp({ lossless: true }).toBuffer(),
  ]) {
    expect(iconDimensions(bytes)).toEqual({ width: 21, height: 13 });
    expect(
      await verifyIconBytes(bytes, { hash: await sha256(bytes), mime: iconMime(bytes)! }),
    ).toEqual({ width: 21, height: 13 });
    await expect(
      verifyIconBytes(bytes, { hash: '0'.repeat(64), mime: iconMime(bytes)! }),
    ).rejects.toThrow('Invalid manifest icon bytes');
    for (const end of [0, 3, 8, 12])
      expect(() => iconDimensions(bytes.subarray(0, end))).toThrow('dimensions');
  }
});

test('oversized signed PNG dimensions and malformed chunk lengths fail before image decode', async () => {
  const png = await image().png().toBuffer();
  png.writeUInt32BE(100_000, 16);
  png.writeUInt32BE(100_000, 20);
  await expect(
    verifyIconBytes(png, { hash: await sha256(png), mime: 'image/png' }),
  ).rejects.toThrow('presentation budget');
  const webp = await image().webp().toBuffer();
  webp.writeUInt32LE(0xffffffff, 16);
  expect(() => iconDimensions(webp)).toThrow('dimensions');
});
