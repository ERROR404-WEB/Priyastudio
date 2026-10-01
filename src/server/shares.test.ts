import { describe, expect, it } from 'vitest';
import { applyCommand } from '../lib/domain';
import { createEmptyState } from '../lib/seed';
import { createShareCommand, hashToken, newToken, proposalView, publicProposalCommand, publicReviewCommand, requireShare, reviewView } from './shares';

const now = '2026-10-01T12:00:00.000Z';
function fixture() {
  let state = applyCommand(createEmptyState(), { type: 'brand.create', data: { id: 'brand', name: 'Public brand', email: 'private@example.test', contact: 'PRIVATE', category: 'Food', notes: 'SECRET' } }, 'admin', now);
  state = applyCommand(state, { type: 'proposal.create', data: { id: 'proposal', brandId: 'brand', title: 'A proposal', items: [{ description: 'Reel', quantity: 1, unitPrice: 50000 }], rights: '', timeline: '', validUntil: '2026-10-05' } }, 'admin', now);
  state = applyCommand(state, { type: 'collaboration.create', data: { id: 'work', brandId: 'brand', title: 'A campaign', category: 'Food', stage: 'posted', dueDate: '2026-10-05', image: '', reelUrl: '', description: 'Private notes' } }, 'admin', now);
  return state;
}

describe('scoped public capabilities', () => {
  it('generates 256-bit tokens, persists only hashes, and bounds expiry to proposal validity in Kolkata', () => {
    const token = newToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const command = createShareCommand(fixture(), 'proposal', 'proposal', token, now);
    expect(command.data.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(command)).not.toContain(token);
    expect(command.data.expiresAt).toBe('2026-10-05T18:30:00.000Z');
  });
  it('rejects wrong scopes, revoked/expired links, and exposes only target projections', () => {
    const token = newToken();
    let state = fixture();
    state = applyCommand(state, createShareCommand(state, 'proposal', 'proposal', token, now), 'admin', now);
    expect(requireShare(state, token, 'proposal', now).targetId).toBe('proposal');
    expect(() => requireShare(state, token, 'review', now)).toThrow();
    expect(() => requireShare(state, token, 'proposal', '2026-10-06T00:00:00Z')).toThrow();
    const view = proposalView(state, token, now);
    expect(view.brandName).toBe('Public brand');
    expect(JSON.stringify(view)).not.toMatch(/SECRET|PRIVATE|private@example|tokenHash|issuerDetails/);
    state = applyCommand(state, { type: 'share.revoke', id: state.shares[0].id }, 'admin', now);
    expect(() => requireShare(state, token, 'proposal', now)).toThrow();
  });
  it('rechecks the share and proposal version when producing each transactional command', () => {
    const token = newToken(); let state = fixture();
    state = applyCommand(state, createShareCommand(state, 'proposal', 'proposal', token, now), 'admin', now);
    expect(() => publicProposalCommand(state, token, { action: 'accept', name: 'Brand', version: 2 }, now)).toThrow();
    const accepted = applyCommand(state, publicProposalCommand(state, token, { action: 'accept', name: 'Brand', version: 1 }, now), 'brand', now);
    expect(accepted.proposals[0].status).toBe('accepted');
    expect(() => publicProposalCommand(accepted, token, { action: 'accept', name: 'Brand', version: 1 }, now)).toThrow();
    const revoked = applyCommand(state, { type: 'share.revoke', id: state.shares[0].id }, 'admin', now);
    expect(() => publicProposalCommand(revoked, token, { action: 'accept', name: 'Brand', version: 1 }, now)).toThrow();
  });
  it('binds testimonials to the shared campaign and validates consent and lengths', () => {
    const token = newToken(); let state = fixture();
    state = applyCommand(state, createShareCommand(state, 'work', 'review', token, now), 'admin', now);
    expect(Object.keys(reviewView(state, token, now).collaboration).sort()).toEqual(['id', 'image', 'reelUrl', 'title']);
    const input = { name: 'Brand', role: 'Owner', text: 'Thoughtful work', consent: true };
    const command = publicReviewCommand(state, token, input, now);
    expect(command.data.collaborationId).toBe('work');
    const submitted = applyCommand(state, command, 'brand', now);
    expect(submitted.testimonials[0].approved).toBe(false);
    expect(() => publicReviewCommand(state, token, { ...input, collaborationId: 'other' }, now)).toThrow();
    expect(() => publicReviewCommand(state, token, { ...input, text: 'x'.repeat(5001) }, now)).toThrow();
    expect(() => publicReviewCommand(state, token, { ...input, consent: false }, now)).toThrow();
  });

  it('keeps spam quotas in persistent state even when an administrator rotates the link', () => {
    let state = fixture();
    const token = newToken();
    state = applyCommand(state, createShareCommand(state, 'proposal', 'proposal', token, now), 'admin', now);
    const body = { action: 'comment', name: 'Brand', text: 'One comment', expectedDate: '', counterOffer: null };
    for (let index = 0; index < 25; index += 1) state = applyCommand(state, publicProposalCommand(state, token, body, now), 'brand', now);
    expect(() => publicProposalCommand(state, token, body, now)).toThrowError(expect.objectContaining({ status: 429 }));
    const rotated = newToken();
    state = applyCommand(state, createShareCommand(state, 'proposal', 'proposal', rotated, now), 'admin', now);
    expect(() => requireShare(state, token, 'proposal', now)).toThrow();
    expect(() => publicProposalCommand(state, rotated, body, now)).toThrowError(expect.objectContaining({ status: 429 }));
    const review = newToken();
    state = applyCommand(state, createShareCommand(state, 'work', 'review', review, now), 'admin', now);
    const reviewBody = { name: 'Brand', role: '', text: 'Review', consent: true };
    for (let index = 0; index < 5; index += 1) state = applyCommand(state, publicReviewCommand(state, review, reviewBody, now), 'brand', now);
    expect(() => publicReviewCommand(state, review, reviewBody, now)).toThrowError(expect.objectContaining({ status: 429 }));
  });
});