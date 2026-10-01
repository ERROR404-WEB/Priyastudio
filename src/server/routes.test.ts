import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as getStudio, POST as postStudio } from '../app/api/studio/route';
import { POST as shareStudio } from '../app/api/studio/share/route';
import { GET as getPortfolio } from '../app/api/public/portfolio/route';
import { GET as getProposal, POST as postProposal } from '../app/api/public/proposal/[token]/route';
import { GET as getReview, POST as postReview } from '../app/api/public/review/[token]/route';
import { POST as postUpload } from '../app/api/upload/route';
import { GET as getMedia } from '../app/api/media/[id]/route';
import { POST as authPost } from '../app/api/auth/[...all]/route';

let directory: string;
beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('DATABASE_URL', '');
  directory = await mkdtemp(join(tmpdir(), 'studio-routes-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
const origin = 'http://localhost:3000';
const get = (path: string) => new Request(origin + path);
const post = (path: string, body: unknown) => new Request(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = (token: string) => ({ params: Promise.resolve({ token }) });

describe('actual API routes in local demo', () => {
  it('persists admin mutations, rejects system commands, and keeps the portfolio allowlisted', async () => {
    const response = await getStudio(get('/api/studio'));
    expect(response.status).toBe(200);
    const { state, demo } = await response.json();
    expect(demo).toBe(true);
    expect(state.invoices.length).toBeGreaterThan(0);
    const created = await postStudio(post('/api/studio', { command: { type: 'brand.create', data: { id: 'new-brand', name: 'New brand', contact: '', email: '', category: 'Food', notes: 'Do not publish this' } } }));
    expect(created.status).toBe(200);
    expect((await (await getStudio(get('/api/studio'))).json()).state.brands.some((brand: { id: string }) => brand.id === 'new-brand')).toBe(true);
    for (const type of ['share.create', 'testimonial.create', 'proposal.accept', 'proposal.comment']) {
      expect((await postStudio(post('/api/studio', { command: { type } }))).status).toBe(403);
    }
    const portfolio = await (await getPortfolio(get('/api/public/portfolio'))).json();
    expect(Object.keys(portfolio).sort()).toEqual(['demo', 'portfolio']);
    expect(JSON.stringify(portfolio)).not.toMatch(/Do not publish|issuerDetails|paymentDetails|invoices|tokenHash/);
  });
  it('issues a full scoped URL, rejects stale acceptance, accepts the correct version, and revokes access', async () => {
    const shared = await shareStudio(post('/api/studio/share', { targetId: 'demo-proposal-1', scope: 'proposal' }));
    expect(shared.status).toBe(200);
    const { state, shareUrl } = await shared.json();
    expect(shareUrl).toMatch(/^http:\/\/localhost:3000\/p\/[A-Za-z0-9_-]{43}$/);
    const token = new URL(shareUrl).pathname.split('/').pop()!;
    expect(JSON.stringify(state)).not.toContain(token);
    expect((await getReview(get('/api/public/review/' + token), context(token))).status).toBe(404);
    const view = await getProposal(get('/api/public/proposal/' + token), context(token));
    expect(view.status).toBe(200);
    expect(view.headers.get('referrer-policy')).toBe('no-referrer');
    expect(Object.keys(await view.json()).sort()).toEqual(['brandName', 'creatorName', 'demo', 'proposal']);
    const action = { action: 'accept', name: 'Reviewer', version: 99 };
    expect((await postProposal(post('/api/public/proposal/' + token, action), context(token))).status).toBe(409);
    expect(await (await postProposal(post('/api/public/proposal/' + token, { ...action, version: 1 }), context(token))).json()).toEqual({ ok: true });
    await postStudio(post('/api/studio', { command: { type: 'share.revoke', id: state.shares[0].id } }));
    expect((await getProposal(get('/api/public/proposal/' + token), context(token))).status).toBe(404);
  });
  it('collects only consented, unpublished reviews for the matching share target', async () => {
    const { shareUrl } = await (await shareStudio(post('/api/studio/share', { targetId: 'demo-work-1', scope: 'review' }))).json();
    const token = new URL(shareUrl).pathname.split('/').pop()!;
    const body = { name: 'Reviewer', role: 'Founder', text: 'Thoughtful work', consent: true };
    expect(await (await postReview(post('/api/public/review/' + token, body), context(token))).json()).toEqual({ ok: true });
    const { state } = await (await getStudio(get('/api/studio'))).json();
    expect(state.testimonials[0]).toMatchObject({ collaborationId: 'demo-work-1', approved: false, consent: true });
    expect((await postReview(post('/api/public/review/' + token, { ...body, consent: false }), context(token))).status).toBe(400);
  });
  it('blocks cross-origin writes, remote demo access, public auth discovery, and missing production config', async () => {
    expect((await postStudio(new Request(origin + '/api/studio', { method: 'POST', headers: { origin: 'https://evil.test' }, body: '{}' }))).status).toBe(403);
    expect((await getStudio(new Request('https://hosted.example/api/studio'))).status).toBe(503);
    for (const path of ['sign-up/email', 'update-user', 'is-username-available']) {
      expect((await authPost(post('/api/auth/' + path, {}))).status).toBe(404);
    }
    vi.stubEnv('NODE_ENV', 'production');
    const response = await getStudio(get('/api/studio'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Server configuration incomplete' });
  });
  it('round-trips a signature-validated public image and rejects SVG and traversal', async () => {
    const upload = async (bytes: Uint8Array, filename: string, type: string) => {
      const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)], { type }), filename);
      return postUpload(new Request(origin + '/api/upload', { method: 'POST', headers: { origin }, body: form }));
    };
    const jpeg = new Uint8Array([255, 216, 255, 224, 0, 0, 255, 217]);
    const result = await upload(jpeg, 'fake-name.txt', 'application/octet-stream');
    expect(result.status).toBe(200);
    const { url } = await result.json();
    const id = url.split('/').pop();
    const image = await getMedia(get(url), { params: Promise.resolve({ id }) });
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);
    expect((await upload(new TextEncoder().encode('<svg/>'), 'image.png', 'image/png')).status).toBe(415);
    expect((await getMedia(get('/api/media/nope'), { params: Promise.resolve({ id: '../studio.json' }) })).status).toBe(404);
  });
});