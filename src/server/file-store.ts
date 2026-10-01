import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StudioState } from '../lib/types';
import type { AggregateStore } from './persistence';

// Local demo only. Per-path serialization includes separate instances in the same Node process.
const queues = new Map<string, Promise<unknown>>();
export class FileAggregateStore implements AggregateStore {
  private readonly path: string;
  constructor(path: string, private readonly initial: () => StudioState) { this.path = resolve(path); }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = (queues.get(this.path) ?? Promise.resolve()).catch(() => undefined).then(operation);
    queues.set(this.path, pending);
    try { return await pending; }
    finally { if (queues.get(this.path) === pending) queues.delete(this.path); }
  }
  private async read(): Promise<StudioState> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as StudioState; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const state = this.initial();
      await this.write(state);
      return state;
    }
  }
  private async write(state: StudioState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path);
    } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
  }
  load(): Promise<StudioState> { return this.exclusive(() => this.read()); }
  compareAndSwap(expectedRevision: number, next: StudioState): Promise<boolean> {
    return this.exclusive(async () => {
      if ((await this.read()).revision !== expectedRevision) return false;
      await this.write(next);
      return true;
    });
  }
}