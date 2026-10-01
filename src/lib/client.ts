/** Browser transport only. The server remains the source of truth for all studio data. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

function describeError(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(describeError).filter(Boolean).join('; ');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (item.message) return describeError(item.message);
    if (item.error) return describeError(item.error);
    if (item.issues) return describeError(item.issues);
    return JSON.stringify(value);
  }
  return '';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export async function requestJSON<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(describeError(body) || (response.status === 503
      ? 'The studio needs its production database and admin configuration before it can open.'
      : `The request could not be completed (${response.status}). Please try again.`), response.status);
  }
  if (body === null) throw new ApiError('The server returned an empty response. Please retry.', response.status);
  return body as T;
}

/** No floating-point multiplication: convert decimal rupee input to exact integer paise. */
export function rupeesToPaise(input: string): number {
  const value = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a positive INR amount with no more than two decimal places (for example, 1500.50).');
  const [whole, fraction = ''] = value.split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (paise <= 0n || paise > 100_000_000_000n) throw new Error('The amount must be greater than zero and no more than ₹1,00,00,00,000.');
  return Number(paise);
}

export function paiseToInput(paise: number): string {
  const value = BigInt(paise);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function normalizePhone(phone: string): string { return phone.replace(/\D/g, ''); }

export async function uploadImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  if (file.size > 4 * 1024 * 1024) throw new Error('Choose an image no larger than 4 MiB.');
  const data = new FormData();
  data.append('file', file);
  const result = await requestJSON<{ url: string }>('/api/upload', { method: 'POST', body: data });
  return result.url;
}