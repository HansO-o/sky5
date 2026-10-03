// worker_threads entry: encodes one image to KTX2 per message.
import { parentPort } from "node:worker_threads";
import { encodeToKTX2 } from "ktx2-encoder";
import sharp from "sharp";

const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

// The wasm encoder prints per-slice debug lines to stdout; silence them.
process.stdout.write = () => true;
console.log = () => {};

parentPort.on("message", async ({ id, png, opts }) => {
  try {
    const out = await encodeToKTX2(new Uint8Array(png), { ...opts, imageDecoder, enableDebug: false });
    parentPort.postMessage({ id, out }, [out.buffer]);
  } catch (e) {
    parentPort.postMessage({ id, error: String(e?.stack ?? e) });
  }
});
