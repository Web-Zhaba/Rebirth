import { describe, expect, it } from "vitest";
import { decodePng } from "./pngDecoder";

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32(out: Uint8Array, at: number, value: number): void {
  out[at] = value >>> 24;
  out[at + 1] = value >>> 16;
  out[at + 2] = value >>> 8;
  out[at + 3] = value;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  writeU32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function makePng(width: number, height: number, channels: 3 | 4, pixels: Uint8Array, filters: number[]): Promise<ArrayBuffer> {
  const stride = width * channels;
  const filtered = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length];
    const sourceAt = y * stride;
    const targetAt = y * (stride + 1);
    filtered[targetAt] = filter;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[sourceAt + x - channels] : 0;
      const up = y > 0 ? pixels[sourceAt - stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[sourceAt - stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      filtered[targetAt + 1 + x] = (pixels[sourceAt + x] - predictor + 256) & 0xff;
    }
  }

  const input = filtered.buffer.slice(filtered.byteOffset, filtered.byteOffset + filtered.byteLength) as ArrayBuffer;
  const compressedStream = new Blob([input]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());
  const header = new Uint8Array(13);
  writeU32(header, 0, width);
  writeU32(header, 4, height);
  header[8] = 8;
  header[9] = channels === 3 ? 2 : 6;
  const split = Math.max(1, Math.floor(compressed.length / 2));
  return concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", compressed.subarray(0, split)),
    chunk("IDAT", compressed.subarray(split)),
    chunk("IEND", new Uint8Array()),
  ]).buffer as ArrayBuffer;
}

describe("byte-exact PNG decoding", () => {
  it("reverses all five PNG row filters and joins split IDAT chunks", async () => {
    const width = 19;
    const height = 7;
    const pixels = new Uint8Array(width * height * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 73 + Math.floor(i / 7) * 29 + 11) & 0xff;

    const png = await makePng(width, height, 3, pixels, [0, 1, 2, 3, 4]);
    const decoded = await decodePng(png);
    const expected = new Uint8Array(width * height * 4);
    for (let i = 0, src = 0; i < expected.length; i += 4, src += 3) {
      expected[i] = pixels[src];
      expected[i + 1] = pixels[src + 1];
      expected[i + 2] = pixels[src + 2];
      expected[i + 3] = 255;
    }

    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.rgba).toEqual(expected);
  });

  it("preserves alpha without premultiplying the encoded RGB channels", async () => {
    const width = 5;
    const height = 4;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 41 + 17) & 0xff;

    const decoded = await decodePng(await makePng(width, height, 4, pixels, [4, 3, 2, 1]));
    expect(decoded.rgba).toEqual(pixels);
  });

  it("rejects malformed and unsupported PNG inputs instead of producing bad elevations", async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow("Invalid PNG signature");
    const png = new Uint8Array(await makePng(2, 2, 3, new Uint8Array(12), [0]));
    png[24] = 16;
    await expect(decodePng(png)).rejects.toThrow("Unsupported PNG format");
  });
});
