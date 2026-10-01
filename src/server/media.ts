import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRuntimeConfig } from './config';
import { HttpError } from './errors';
import { readBytes } from './http';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Mime = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImage(data: Uint8Array): Mime {
  if (!data.length || data.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image must be at most 4 MB');
  const bytes = Buffer.from(data);
  if (bytes.length >= 8 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return 'image/jpeg';
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.subarray(12, 16).toString('ascii') === 'IHDR' && bytes.readUInt32BE(8) === 13
    && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0) return 'image/png';
  if (bytes.length >= 20 && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString('ascii'))) return 'image/webp';
  throw new HttpError(415, 'Only JPEG, PNG, or WebP image bytes are accepted');
}

export async function readUpload(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw new HttpError(415, 'Expected multipart/form-data');
  const bytes = await readBytes(request, MAX_IMAGE_BYTES + 64 * 1024);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData(); }
  catch { throw new HttpError(400, 'Invalid multipart upload'); }
  if ([...form.keys()].length !== 1 || form.getAll('file').length !== 1) throw new HttpError(400, 'Upload exactly one file');
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'File required');
  const data = new Uint8Array(await file.arrayBuffer());
  detectImage(data);
  return data;
}

/** ALL uploads are public portfolio imagery. Never use this API for invoices/private attachments. */
export async function saveImage(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const config = getRuntimeConfig();
  const contentType = detectImage(data);
  const id = randomUUID();
  if (config) {
    const store = getStore({ name: 'studio-public-media', consistency: 'strong' });
    await store.set(id, data.buffer, { metadata: { contentType } });
  } else {
    const directory = join(process.cwd(), '.data', 'media');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, id), data, { flag: 'wx', mode: 0o600 });
  }
  return `/api/media/${id}`;
}

export async function loadImage(id: string): Promise<{ data: Uint8Array<ArrayBuffer>; contentType: Mime }> {
  const config = getRuntimeConfig();
  if (!uuid.test(id)) throw new HttpError(404, 'Image not found');
  let data: Uint8Array<ArrayBuffer>;
  if (config) {
    const value = await getStore({ name: 'studio-public-media', consistency: 'strong' }).get(id, { type: 'arrayBuffer' });
    if (!value) throw new HttpError(404, 'Image not found');
    data = new Uint8Array(value);
  } else {
    try { data = new Uint8Array(await readFile(join(process.cwd(), '.data', 'media', id))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Image not found');
      throw error;
    }
  }
  return { data, contentType: detectImage(data) };
}