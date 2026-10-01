import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { commandSchema } from '../lib/domain';
import type { Command, ProposalView, ReviewView, ShareLink, StudioState } from '../lib/types';
import { HttpError } from './errors';

type ShareCommand = Extract<Command, { type: 'share.create' }>;
type ReviewCommand = Extract<Command, { type: 'testimonial.create' }>;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export function newToken(): string { return randomBytes(32).toString('base64url'); }
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
const notFound = () => new HttpError(404, 'Share unavailable or expired');

/** Midnight *after* validUntil in Asia/Kolkata. Expiry is exclusive. */
function proposalExpiry(validUntil: string): number {
  return Date.parse(`${validUntil}T00:00:00+05:30`) + 86_400_000;
}

export function createShareCommand(state: StudioState, targetId: string, scope: ShareLink['scope'], token: string, now: string): ShareCommand {
  let expires = Date.parse(now) + 14 * 86_400_000;
  if (scope === 'proposal') {
    const proposal = state.proposals.find((item) => item.id === targetId);
    if (!proposal) throw new HttpError(404, 'Proposal not found');
    expires = Math.min(expires, proposalExpiry(proposal.validUntil));
    if (expires <= Date.parse(now)) throw new HttpError(422, 'Cannot share an expired proposal');
  } else if (!state.collaborations.some((item) => item.id === targetId)) throw new HttpError(404, 'Collaboration not found');
  return { type: 'share.create', data: { id: randomUUID(), targetId, scope, tokenHash: hashToken(token), expiresAt: new Date(expires).toISOString() } };
}

export function requireShare(state: StudioState, token: string, scope: ShareLink['scope'], now = new Date().toISOString()): ShareLink {
  if (!tokenPattern.test(token)) throw notFound();
  const hash = Buffer.from(hashToken(token), 'hex');
  const share = state.shares.find((item) => item.scope === scope && /^[a-f0-9]{64}$/.test(item.tokenHash)
    && timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), hash));
  if (!share || share.revokedAt || !Number.isFinite(Date.parse(share.expiresAt)) || Date.parse(share.expiresAt) <= Date.parse(now)) throw notFound();
  if (scope === 'proposal') {
    const proposal = state.proposals.find((item) => item.id === share.targetId);
    if (!proposal || proposal.status === 'draft' || proposalExpiry(proposal.validUntil) <= Date.parse(now)) throw notFound();
  } else if (!state.collaborations.some((item) => item.id === share.targetId)) throw notFound();
  return share;
}

export function proposalView(state: StudioState, token: string, now?: string): ProposalView {
  const share = requireShare(state, token, 'proposal', now);
  const item = state.proposals.find((item) => item.id === share.targetId)!;
  const brand = state.brands.find((brand) => brand.id === item.brandId);
  if (!brand) throw notFound();
  // No spreading domain objects: future private fields must not leak onto capability views.
  return { brandName: brand.name, creatorName: state.profile.name, proposal: {
    id: item.id, brandId: item.brandId, title: item.title,
    items: item.items.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
    rights: item.rights, timeline: item.timeline, validUntil: item.validUntil, version: item.version, status: item.status,
    comments: item.comments.map(({ id, name, text, expectedDate, counterOffer, createdAt }) => ({ id, name, text, expectedDate, counterOffer, createdAt })),
    acceptedBy: item.acceptedBy, acceptedAt: item.acceptedAt, createdAt: item.createdAt,
  } };
}

export function reviewView(state: StudioState, token: string, now?: string): ReviewView {
  const share = requireShare(state, token, 'review', now);
  const item = state.collaborations.find((item) => item.id === share.targetId)!;
  const brand = state.brands.find((brand) => brand.id === item.brandId);
  if (!brand) throw notFound();
  return { collaboration: { id: item.id, title: item.title, image: item.image, reelUrl: item.reelUrl }, brandName: brand.name, creatorName: state.profile.name };
}

const plain = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/<\/?[a-z][^>]*>/i.test(value), 'Plain text required');
const proposalInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), name: plain(200), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('comment'), name: plain(200), text: plain(5000), expectedDate: z.string().max(10), counterOffer: z.number().int().positive().max(100_000_000_000).nullable() }).strict(),
]);
const reviewInput = z.object({ name: plain(200), role: z.string().trim().max(200), text: plain(5000), consent: z.literal(true) }).strict();

export function publicProposalCommand(state: StudioState, token: string, body: unknown, now: string): Command {
  const share = requireShare(state, token, 'proposal', now);
  const proposal = state.proposals.find((item) => item.id === share.targetId)!;
  const input = proposalInput.parse(body);
  if (proposal.status !== 'sent') throw new HttpError(409, 'Proposal is no longer awaiting a response');
  if (input.action === 'accept') {
    if (input.version !== proposal.version) throw new HttpError(409, 'Proposal version is stale; reload before accepting');
    return { type: 'proposal.accept', id: proposal.id, name: input.name, version: input.version };
  }
  // Target-level persisted quotas cannot be bypassed by rotating a share or cold-starting a function.
  if (proposal.comments.length >= 25) throw new HttpError(429, 'This proposal has reached its comment limit');
  return commandSchema.parse({ type: 'proposal.comment', id: proposal.id, data: {
    id: randomUUID(), name: input.name, text: input.text, expectedDate: input.expectedDate, counterOffer: input.counterOffer,
  } });
}

export function publicReviewCommand(state: StudioState, token: string, body: unknown, now: string): ReviewCommand {
  const share = requireShare(state, token, 'review', now);
  const input = reviewInput.parse(body);
  if (state.testimonials.filter((item) => item.collaborationId === share.targetId).length >= 5) throw new HttpError(429, 'This campaign has reached its review limit');
  return { type: 'testimonial.create', data: { id: randomUUID(), collaborationId: share.targetId, ...input } };
}