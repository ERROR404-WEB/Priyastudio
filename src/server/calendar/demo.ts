import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Shoot, ShootInput } from '../../lib/calendar';
import { HttpError } from '../errors';
import { conflict, pendingShoot, sameInput } from './model';

// Only the loopback, single-process demo uses file serialization. Hosted storage never uses this.
const queues = new Map<string, Promise<unknown>>();
export class DemoCalendarRepository {
	private readonly path: string;
	constructor(path: string) { this.path = resolve(path); }
	private async exclusive<T>(work: () => Promise<T>): Promise<T> {
		const pending = (queues.get(this.path) ?? Promise.resolve()).catch(() => undefined).then(work);
		queues.set(this.path, pending);
		try { return await pending; } finally { if (queues.get(this.path) === pending) queues.delete(this.path); }
	}
	private async read(): Promise<Shoot[]> {
		try {
			const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
			if (!Array.isArray(parsed)) throw new Error('Invalid demo calendar');
			return parsed as Shoot[];
		} catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
	}
	private async write(shoots: Shoot[]): Promise<void> {
		await mkdir(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		try { await writeFile(temporary, JSON.stringify(shoots), { flag: 'wx', mode: 0o600 }); await rename(temporary, this.path); }
		finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
	}
	list(): Promise<Shoot[]> { return this.exclusive(() => this.read()); }
	save(input: ShootInput, expected: number): Promise<Shoot> {
		return this.exclusive(async () => {
			const all = await this.read(); const current = all.find((item) => item.id === input.id);
			if (current?.revision === expected + 1 && sameInput(current, input)) return current;
			if ((current?.revision ?? 0) !== expected || current?.cancelled) return conflict();
			const next = pendingShoot(input, expected + 1);
			await this.write([...all.filter((item) => item.id !== input.id), next]); return next;
		});
	}
	cancel(id: string, expected: number): Promise<Shoot> {
		return this.exclusive(async () => {
			const all = await this.read(); const current = all.find((item) => item.id === id);
			if (!current) throw new HttpError(404, 'Shoot not found');
			if (current.cancelled && current.revision === expected + 1) return current;
			if (current.revision !== expected) return conflict();
			const next: Shoot = { ...current, cancelled: true, status: 'cancelled', revision: expected + 1, error: null };
			await this.write(all.map((item) => item.id === id ? next : item)); return next;
		});
	}
}