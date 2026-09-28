/* The gzip around a `tracker graph`.

   The contract — `{ modules[], nodes[] }`, whose entries name each other by index — is
   already compact: every id and module name is written once, and a dependency is a
   number. What is left for a build to save is what gzip saves, which on the graph of
   every declaration of a large project is 17MB down to 4MB. A column form on top of it
   would take off 7% more, not worth a second format. */

/* ---------- gzip ---------- */

/* The first two bytes of a gzip member, which is how a dropped file says what it is. */
export const isGzip = (head) => head[0] === 0x1f && head[1] === 0x8b;

const GZIP_UNSUPPORTED =
  "This browser cannot decompress gzip (DecompressionStream is missing).";

/* Gzipped bytes, or a stream of them, straight into the parsed graph: between the
   decompressor and the parser the JSON never becomes a string on this side. */
export async function inflateJson(source) {
  if (typeof DecompressionStream !== "function") throw new Error(GZIP_UNSUPPORTED);
  const stream = source instanceof ReadableStream ? source : new Blob([source]).stream();
  return new Response(stream.pipeThrough(new DecompressionStream("gzip"))).json();
}

/* base64 is how bytes ride in an HTML attribute or a script element; it costs a third
   more than the bytes and is still a fraction of what the JSON would have cost. */
export function bytesFromBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
