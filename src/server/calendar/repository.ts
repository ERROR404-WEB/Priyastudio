import { randomUUID } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Shoot, ShootInput } from '../../lib/calendar';
import type { StudioDatabase } from '../database';
import { HttpError } from '../errors';
import { calendarConnections as connections, calendarShoots as shoots, calendarOAuthStates as states } from '../schema';
import { conflict, pendingShoot, sameInput, type Lease, type StoredShoot } from './model';

const stored = (row: typeof shoots.$inferSelect): StoredShoot => ({ shoot: row.body, eventGeneration: row.eventGeneration, syncedEpoch: row.syncedEpoch });
const identity = (owner: string, id: string) => and(eq(shoots.ownerId, owner), eq(shoots.id, id));
const leaseCondition = (lease: Lease) => and(eq(connections.ownerId, lease.owner), eq(connections.epoch, lease.epoch),
	eq(connections.leaseToken, lease.token), sql`${connections.leaseUntil} > now() + interval '15 seconds'`, sql`${connections.blockedUntil} <= now()`);

/** Every concurrency decision is one SQL statement, compatible with Neon HTTP and serverless callers. */
export class CalendarRepository {
	constructor(private readonly db: StudioDatabase) {}
	async connection(owner: string) {
		await this.db.insert(connections).values({ ownerId: owner, namespace: randomUUID() }).onConflictDoNothing();
		const [row] = await this.db.select().from(connections).where(eq(connections.ownerId, owner));
		return row;
	}
	async list(owner: string): Promise<StoredShoot[]> {
		return (await this.db.select().from(shoots).where(eq(shoots.ownerId, owner))).map(stored);
	}
	async get(owner: string, id: string): Promise<StoredShoot | null> {
		const [row] = await this.db.select().from(shoots).where(identity(owner, id));
		return row ? stored(row) : null;
	}
	async save(owner: string, input: ShootInput, expected: number): Promise<StoredShoot> {
		await this.connection(owner);
		const body = pendingShoot(input, expected + 1);
		const rows = expected === 0
			? await this.db.insert(shoots).values({ ownerId: owner, id: input.id, revision: 1, body }).onConflictDoNothing().returning()
			: await this.db.update(shoots).set({ body, revision: expected + 1 }).where(and(identity(owner, input.id), eq(shoots.revision, expected), sql`${shoots.body}->>'cancelled' = 'false'`)).returning();
		if (rows[0]) return stored(rows[0]);
		const existing = await this.get(owner, input.id);
		if (existing && existing.shoot.revision === expected + 1 && sameInput(existing.shoot, input)) return existing;
		return conflict();
	}
	async cancel(owner: string, id: string, expected: number): Promise<StoredShoot> {
		const current = await this.get(owner, id);
		if (!current) throw new HttpError(404, 'Shoot not found');
		if (current.shoot.cancelled && current.shoot.revision === expected + 1) return current;
		if (current.shoot.revision !== expected) return conflict();
		const body: Shoot = { ...current.shoot, cancelled: true, status: 'pending', error: null, revision: expected + 1 };
		const [row] = await this.db.update(shoots).set({ body, revision: body.revision }).where(and(identity(owner, id), eq(shoots.revision, expected))).returning();
		return row ? stored(row) : conflict();
	}
	async claim(owner: string): Promise<Lease | null> {
		await this.connection(owner);
		const token = randomUUID();
		const [row] = await this.db.update(connections).set({ leaseToken: token, leaseUntil: sql`now() + interval '180 seconds'` })
			.where(and(eq(connections.ownerId, owner), sql`${connections.blockedUntil} <= now()`, or(isNull(connections.leaseToken), sql`${connections.leaseUntil} <= now()`))).returning();
		return row ? { owner, token, epoch: row.epoch, namespace: row.namespace, credentials: row.credentials } : null;
	}
	async valid(lease: Lease): Promise<boolean> {
		return (await this.db.select({ owner: connections.ownerId }).from(connections).where(leaseCondition(lease))).length === 1;
	}
	async release(lease: Lease): Promise<void> {
		await this.db.update(connections).set({ leaseToken: null }).where(and(eq(connections.ownerId, lease.owner), eq(connections.leaseToken, lease.token)));
	}
	private fenced(lease: Lease, value: StoredShoot) {
		return and(identity(lease.owner, value.shoot.id), eq(shoots.revision, value.shoot.revision), eq(shoots.eventGeneration, value.eventGeneration),
			sql`exists (select 1 from ${connections} where ${leaseCondition(lease)})`);
	}
	async finish(lease: Lease, value: StoredShoot, status: Shoot['status'], error: string | null): Promise<boolean> {
		const [row] = await this.db.update(shoots).set({ body: { ...value.shoot, status, error }, syncedEpoch: status === 'synced' || status === 'cancelled' ? lease.epoch : value.syncedEpoch })
			.where(this.fenced(lease, value)).returning({ id: shoots.id });
		return !!row;
	}
	async advanceGeneration(lease: Lease, value: StoredShoot): Promise<boolean> {
		return (await this.db.update(shoots).set({ eventGeneration: value.eventGeneration + 1 }).where(this.fenced(lease, value)).returning({ id: shoots.id })).length === 1;
	}
	async link(lease: Lease, envelope: string): Promise<boolean> {
		return (await this.db.update(connections).set({ credentials: envelope, epoch: lease.epoch + 1, reconnectRequired: false })
			.where(and(leaseCondition(lease), isNull(connections.credentials))).returning({ id: connections.ownerId })).length === 1;
	}
	async replaceCredentials(lease: Lease, envelope: string): Promise<boolean> {
		return (await this.db.update(connections).set({ credentials: envelope }).where(and(leaseCondition(lease), sql`${connections.credentials} IS NOT NULL`)).returning({ id: connections.ownerId })).length === 1;
	}
	/** Invalidate immediately even while an exchange/sync is in flight. Block reconsent during revocation. */
	async disconnect(owner: string, reconnectRequired: boolean, expectedEpoch?: number, lease?: Lease) {
		for (let attempt = 0; attempt < 3; attempt++) {
			const previous = await this.connection(owner);
			if (expectedEpoch !== undefined && previous.epoch !== expectedEpoch) return null;
			const [row] = await this.db.update(connections).set({ credentials: null, epoch: previous.epoch + 1, reconnectRequired, blockedUntil: sql`now() + interval '30 seconds'` })
				.where(and(eq(connections.ownerId, owner), eq(connections.epoch, previous.epoch), lease ? leaseCondition(lease) : undefined)).returning();
			if (row) return { previous, epoch: row.epoch };
			// A delayed refresh failure must not invalidate the replacement worker's grant.
			if (lease) return null;
		}
		throw new HttpError(409, 'Calendar connection changed. Try again.');
	}
	async endDisconnect(owner: string, epoch: number): Promise<void> {
		await this.db.update(connections).set({ blockedUntil: sql`now()` }).where(and(eq(connections.ownerId, owner), eq(connections.epoch, epoch)));
	}
	async putOAuth(lease: Lease, stateHash: string, browserHash: string, verifier: string): Promise<void> {
		const data = { ownerId: lease.owner, epoch: lease.epoch, stateHash, browserHash, verifier, expiresAt: sql`now() + interval '10 minutes'` };
		await this.db.insert(states).values(data).onConflictDoUpdate({ target: states.ownerId, set: data });
	}
	async consumeOAuth(owner: string, stateHash: string, browserHash: string) {
		const [state] = await this.db.delete(states).where(and(eq(states.ownerId, owner), eq(states.stateHash, stateHash), eq(states.browserHash, browserHash), sql`${states.expiresAt} > now()`)).returning();
		return state ?? null;
	}
}