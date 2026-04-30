import QRCode from "qrcode";

/**
 * Render `text` as a PNG QR code. Caller decides what to encode (typically
 * the `short_url` for a token). Synchronous-looking but the underlying lib
 * runs the encode off-thread, so we await the buffer.
 */
export async function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: "png" });
}
