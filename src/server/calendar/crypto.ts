import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptionKey(value: string): Buffer {
	const key = Buffer.from(value, 'base64');
	if (key.length !== 32 || key.toString('base64') !== value) throw new Error('Calendar encryption key must be base64-encoded 32 bytes');
	return key;
}
export function encrypt(plaintext: string, key: string, context: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
	cipher.setAAD(Buffer.from(`hey-priya:calendar:v1:${context}`));
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function decrypt(envelope: string, key: string, context: string): string {
	try {
		const parts = envelope.split('.');
		if (parts.length !== 4 || parts[0] !== 'v1' || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
		const [iv, tag, ciphertext] = parts.slice(1).map((part) => Buffer.from(part, 'base64url'));
		if (iv.length !== 12 || tag.length !== 16) throw new Error();
		const cipher = createDecipheriv('aes-256-gcm', encryptionKey(key), iv);
		cipher.setAAD(Buffer.from(`hey-priya:calendar:v1:${context}`)); cipher.setAuthTag(tag);
		return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
	} catch { throw new Error('Calendar credentials cannot be decrypted; reconnect required'); }
}