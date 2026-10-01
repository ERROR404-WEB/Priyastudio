import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createEmptyState } from '../lib/seed';
import type { Command } from '../lib/types';
import { FileAggregateStore } from './file-store';
import { PostgresAggregateStore } from './postgres-store';
import { mutateStore } from './persistence';
import * as schema from './schema';
import { createShareCommand, newToken, publicProposalCommand } from './shares';
import { migrationStatements } from './migrations';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const brand = (id: string): Command => ({ type: 'brand.create', data: { id, name: id, contact: '', email: '', category: 'Food', notes: '' } });

describe('atomic aggregate persistence', () => {
  it('serializes concurrent file writes and survives a fresh store instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-test-'));
    directories.push(directory);
    const path = join(directory, 'studio.json');
    const store = new FileAggregateStore(path, createEmptyState);
    await Promise.all([mutateStore(store, brand('one'), 'admin'), mutateStore(store, brand('two'), 'admin')]);
    const reloaded = await new FileAggregateStore(path, createEmptyState).load();
    expect(reloaded.brands.map((item) => item.id).sort()).toEqual(['one', 'two']);
    expect(reloaded.revision).toBe(2);
    expect(JSON.parse(await readFile(path, 'utf8')).audit).toHaveLength(2);
    await expect(mutateStore(store, brand('one'), 'admin')).rejects.toMatchObject({ status: 422 });
    expect((await store.load()).revision).toBe(2);
  });

  it('never overwrites a corrupt demo file with a fresh seed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-corrupt-'));
    directories.push(directory);
    const path = join(directory, 'studio.json');
    await writeFile(path, '{corrupt');
    await expect(new FileAggregateStore(path, createEmptyState).load()).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('{corrupt');
  });

  it('bounds conflict retries and never commits the failed command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-conflicts-'));
    directories.push(directory);
    const store = new FileAggregateStore(join(directory, 'studio.json'), createEmptyState);
    let collisions = 0;
    const contendedStore = {
      load: async () => {
        const snapshot = await store.load();
        await mutateStore(store, brand(`concurrent-${++collisions}`), 'other-writer');
        return snapshot;
      },
      compareAndSwap: store.compareAndSwap.bind(store),
    };
    await expect(mutateStore(contendedStore, brand('never-committed'), 'admin', 3)).rejects.toMatchObject({ status: 409 });
    expect(collisions).toBe(3);
    const state = await store.load();
    expect(state.brands.map((item) => item.id)).toEqual(['concurrent-1', 'concurrent-2', 'concurrent-3']);
    expect(state.audit).toHaveLength(3);
  });

  it('runs the idempotent migration twice and retries real PostgreSQL CAS conflicts without lost updates', async () => {
    const pg = new PGlite();
    try {
      const migration = await readFile(new URL('../../drizzle/0000_studio.sql', import.meta.url), 'utf8');
      // Exercise the same individual statements sent by the hosted Neon migration script.
      for (let run = 0; run < 2; run += 1) {
        for (const statement of migrationStatements(migration)) await pg.exec(statement);
      }
      const db = drizzle(pg, { schema });
      const store = new PostgresAggregateStore(db);
      const initial = await store.load();
      expect(initial.brands).toEqual([]);
      await Promise.all(Array.from({ length: 5 }, (_, index) => mutateStore(store, brand(`brand-${index}`), 'admin')));
      const state = await new PostgresAggregateStore(db).load();
      expect(state.brands).toHaveLength(5);
      expect(state.audit).toHaveLength(5);
      expect(state.revision).toBe(5);
      expect(await store.compareAndSwap(initial.revision, initial)).toBe(false);
      await expect(mutateStore(store, brand('no-write'), 'admin', 0)).rejects.toMatchObject({ status: 409 });
      expect((await store.load()).brands).toHaveLength(5);
    } finally { await pg.close(); }
  }, 30_000);

  it('rechecks capability revocation after a real database conflict instead of committing stale acceptance', async () => {
    const pg = new PGlite();
    try {
      await pg.exec(await readFile(new URL('../../drizzle/0000_studio.sql', import.meta.url), 'utf8'));
      const store = new PostgresAggregateStore(drizzle(pg, { schema }));
      await mutateStore(store, brand('owner'), 'admin');
      await mutateStore(store, { type: 'proposal.create', data: { id: 'offer', brandId: 'owner', title: 'Offer', items: [{ description: 'Reel', quantity: 1, unitPrice: 10000 }], rights: '', timeline: '', validUntil: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) } }, 'admin');
      const token = newToken();
      const shared = await mutateStore(store, (state, now) => createShareCommand(state, 'offer', 'proposal', token, now), 'admin');
      // Schedule a real concurrent revocation between snapshot read and CAS, not a fake CAS result.
      let first = true;
      let reads = 0;
      const racingStore = {
        load: async () => {
          reads += 1;
          const snapshot = await store.load();
          if (first) {
            first = false;
            await mutateStore(store, { type: 'share.revoke', id: shared.shares[0].id }, 'admin');
          }
          return snapshot;
        },
        compareAndSwap: store.compareAndSwap.bind(store),
      };
      await expect(mutateStore(racingStore, (state, now) => publicProposalCommand(state, token, { action: 'accept', name: 'Brand', version: 1 }, now), 'brand')).rejects.toMatchObject({ status: 404 });
      expect(reads).toBe(2);
      expect((await store.load()).proposals[0].status).toBe('sent');
      expect((await store.load()).audit.some((entry) => entry.action === 'proposal.accept')).toBe(false);
    } finally { await pg.close(); }
  }, 30_000);
});