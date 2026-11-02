import { describe, expect, it } from "vitest";
import { decodeDemTile } from "./tiles";
import { decodeTerrarium } from "./terrain";

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

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

function concat(parts: Uint8Array[]): ArrayBuffer {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

async function terrariumPng(): Promise<ArrayBuffer> {
  const size = 256;
  const stride = size * 3;
  const filtered = new Uint8Array(size * (stride + 1));
  const expected: number[] = [];
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    filtered[row] = 0; // PNG filter None: the test focuses on the shared water/DEM loading path
    for (let x = 0; x < size; x++) {
      const h = ((x * 17 + y * 31) % 700) - 120;
      const encoded = h + 32768;
      const r = Math.floor(encoded / 256);
      const g = Math.floor(encoded) & 255;
      const b = Math.round((encoded - Math.floor(encoded)) * 256) & 255;
      const o = row + 1 + x * 3;
      filtered[o] = r;
      filtered[o + 1] = g;
      filtered[o + 2] = b;
      expected.push(decodeTerrarium(r, g, b));
    }
  }

  const input = filtered.buffer.slice(filtered.byteOffset, filtered.byteOffset + filtered.byteLength) as ArrayBuffer;
  const compressed = new Uint8Array(await new Response(new Blob([input]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, size);
  writeU32(ihdr, 4, size);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB, 8-bit
  return concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())]);
}

describe("shared Terrarium loading for terrain and water", () => {
  it("decodes raw PNG bytes into the exact DEM values used by water heights", async () => {
    const png = await terrariumPng();
    const heights = await decodeDemTile(png);
    expect(heights).toHaveLength(256 * 256);
    expect(heights[0]).toBe(decodeTerrarium(127, 136, 0));
    expect(heights[255 * 256 + 255]).toBeGreaterThanOrEqual(-120);
    expect(heights[255 * 256 + 255]).toBeLessThan(580);
  });

  it("rejects a PNG whose dimensions do not match a Terrarium DEM tile", async () => {
    const filtered = new Uint8Array([0, 0, 0, 0]);
    const input = filtered.buffer.slice(0) as ArrayBuffer;
    const compressed = new Uint8Array(await new Response(new Blob([input]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const ihdr = new Uint8Array(13);
    writeU32(ihdr, 0, 1);
    writeU32(ihdr, 4, 1);
    ihdr[8] = 8;
    ihdr[9] = 2;
    await expect(decodeDemTile(concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())]))).rejects.toThrow("Unexpected Terrarium tile size");
  });
});
