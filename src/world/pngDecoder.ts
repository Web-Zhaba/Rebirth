// Byte-exact PNG decoding for elevation tiles. Do not use ImageBitmap/canvas here: colour conversion in
// browser image pipelines can change encoded RGB channels, and Terrarium interprets those bytes as metres.
//
// Supported source formats are the 8-bit RGB and RGBA PNGs used by the Terrarium elevation tile set, and 8-bit
// greyscale (the biome map, world/biomes.ts: class ids, expanded to R = G = B). PNG's five
// per-row filters are reversed explicitly; IDAT's zlib stream is inflated by the standard Compression Streams API.

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array<ArrayBuffer>;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const MAX_PIXELS = 16 * 1024 * 1024;

function uint32be(bytes: Uint8Array, at: number): number {
  return bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function ascii(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export async function decodePng(input: ArrayBuffer | Uint8Array): Promise<DecodedPng> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new Error("Invalid PNG signature");

  let width = 0;
  let height = 0;
  let channels = 0;
  let hasHeader = false;
  let hasEnd = false;
  const idat: Uint8Array[] = [];
  let idatLength = 0;

  for (let at = 8; at + 12 <= bytes.length;) {
    const length = uint32be(bytes, at);
    const typeAt = at + 4;
    const dataAt = at + 8;
    const end = dataAt + length;
    if (end + 4 > bytes.length) throw new Error("Truncated PNG chunk");
    const type = ascii(bytes, typeAt);

    if (type === "IHDR") {
      if (hasHeader || length !== 13) throw new Error("Invalid PNG header");
      width = uint32be(bytes, dataAt);
      height = uint32be(bytes, dataAt + 4);
      const bitDepth = bytes[dataAt + 8];
      const colorType = bytes[dataAt + 9];
      const compression = bytes[dataAt + 10];
      const filter = bytes[dataAt + 11];
      const interlace = bytes[dataAt + 12];
      if (!width || !height || width * height > MAX_PIXELS) throw new Error("Invalid PNG dimensions");
      if (bitDepth !== 8 || (colorType !== 0 && colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format: bit depth ${bitDepth}, colour type ${colorType}`);
      }
      if (compression !== 0 || filter !== 0 || interlace !== 0) throw new Error("Unsupported PNG encoding");
      channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
      hasHeader = true;
    } else if (type === "IDAT") {
      if (!hasHeader || hasEnd) throw new Error("PNG image data is out of order");
      idat.push(bytes.subarray(dataAt, end));
      idatLength += length;
    } else if (type === "IEND") {
      if (length !== 0) throw new Error("Invalid PNG end chunk");
      hasEnd = true;
      break;
    }

    at = end + 4;
  }

  if (!hasHeader || !hasEnd || !idatLength) throw new Error("Incomplete PNG image");
  const compressed = new Uint8Array(idatLength);
  let offset = 0;
  for (const part of idat) {
    compressed.set(part, offset);
    offset += part.length;
  }

  // PNG IDAT stores a zlib-wrapped DEFLATE stream. Decompress bytes directly, without colour management.
  const compressedBuffer = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer;
  const stream = new Blob([compressedBuffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  const filtered = new Uint8Array(await new Response(stream).arrayBuffer());
  const stride = width * channels;
  const expectedLength = height * (stride + 1);
  if (filtered.length !== expectedLength) {
    throw new Error(`Invalid PNG data length: expected ${expectedLength}, received ${filtered.length}`);
  }

  const raw = new Uint8Array(height * stride);
  let sourceAt = 0;
  for (let y = 0; y < height; y++) {
    const filter = filtered[sourceAt++];
    if (filter > 4) throw new Error(`Unsupported PNG row filter: ${filter}`);
    const rowAt = y * stride;
    const prevAt = rowAt - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? raw[rowAt + x - channels] : 0;
      const up = y > 0 ? raw[prevAt + x] : 0;
      const upperLeft = y > 0 && x >= channels ? raw[prevAt + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      raw[rowAt + x] = (filtered[sourceAt++] + predictor) & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0, src = 0, dst = 0; pixel < width * height; pixel++, src += channels, dst += 4) {
    const grey = channels === 1;
    rgba[dst] = raw[src];
    rgba[dst + 1] = raw[grey ? src : src + 1];
    rgba[dst + 2] = raw[grey ? src : src + 2];
    rgba[dst + 3] = channels === 4 ? raw[src + 3] : 255;
  }
  return { width, height, rgba };
}
