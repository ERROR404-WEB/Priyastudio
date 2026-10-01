'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, Flower2, LockKeyhole, MessageCircle } from 'lucide-react';
import { Wordmark } from './portfolio';
import { ApiError, errorMessage, requestJSON, rupeesToPaise } from '@/lib/client';
import { formatMoney, todayISO } from '@/lib/domain';
import type { ProposalView, ReviewView } from '@/lib/types';

function ShareFrame({ children }: { children: ReactNode }) {
  return <div className="share-page"><header className="share-header"><Link href="/" aria-label="Hey Priya portfolio"><Wordmark /></Link><span><LockKeyhole size={13} /> A LITTLE SOMETHING, JUST FOR YOU</span></header>{children}<p className="share-footnote">This is a private invitation, accessible to anyone with its link. Please do not forward it.<br />Hey Priya Studio · Thoughtful collaborations start with a conversation.</p></div>;
}
function useShare<T>(url: string) {
  const [data, setData] = useState<(T & { demo: boolean }) | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    requestJSON<T & { demo: boolean }>(url, { signal: controller.signal }).then(setData).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof ApiError && err.status === 404 ? 'This invitation has expired, was replaced, or is no longer available. Please ask Priya for a new link.' : errorMessage(err));
    });
    return () => controller.abort();
  }, [url]);
  async function refresh() { setData(await requestJSON<T & { demo: boolean }>(url)); }
  return { data, error, refresh };
}
function LoadingShare({ error }: { error: string }) {
  return <ShareFrame><main className="share-loading"><Flower2 size={42} strokeWidth={1} /><h1>{error ? 'A little pause in the story.' : 'Opening your invitation…'}</h1><p role={error ? 'alert' : 'status'}>{error || 'Gathering the lovely details.'}</p>{error && <Link className="button button-secondary" href="/">Visit Priya’s portfolio <ArrowUpRight size={16} /></Link>}</main></ShareFrame>;
}
const input = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) ?? '').trim();

export function PublicProposal({ token }: { token: string }) {
  const url = `/api/public/proposal/${encodeURIComponent(token)}`;
  const { data, error, refresh } = useShare<ProposalView>(url);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [sent, setSent] = useState(false);
  const [accepting, setAccepting] = useState(false);
  if (!data) return <LoadingShare error={error} />;
  const { proposal, creatorName, brandName, demo } = data;
  async function comment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    setPending(true); setActionError(''); setSent(false);
    try {
      const amount = input(form, 'counterOffer');
      await requestJSON(url, { method: 'POST', body: JSON.stringify({ action: 'comment', name: input(form, 'name'), text: input(form, 'text'), expectedDate: input(form, 'expectedDate'), counterOffer: amount ? rupeesToPaise(amount) : null }) });
      setSent(true); form.reset(); await refresh();
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setPending(false); }
  }
  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setActionError('');
    try {
      await requestJSON(url, { method: 'POST', body: JSON.stringify({ action: 'accept', name: input(event.currentTarget, 'name'), version: proposal.version }) });
      await refresh(); setAccepting(false);
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setPending(false); }
  }
  return <ShareFrame><main><div className="share-intro"><span className="eyebrow">{creatorName.toUpperCase()} × {brandName.toUpperCase()}</span><h1>A lovely story,<br /><i>made together.</i></h1><p>{proposal.title}</p></div><div className="share-layout"><div>
    {demo && <p className="share-notice">SAMPLE PROPOSAL · This local demonstration is not a real commercial offer.</p>}
    <section className="share-card"><span className="eyebrow">THE CREATIVE PLAN · VERSION {proposal.version}</span><h2 style={{ marginTop: 10 }}>Here’s what we can create.</h2>{proposal.items.map((item, i) => <div key={i} className="share-line"><div>{item.description}<small>{item.quantity} × {formatMoney(item.unitPrice)}</small></div><strong>{formatMoney(item.quantity * item.unitPrice)}</strong></div>)}<div className="share-total"><span>Total investment · INR</span><strong>{formatMoney(proposal.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))}</strong></div></section>
    <section className="share-card"><h2>The thoughtful details.</h2><div className="share-detail"><h3>Usage, rights & terms</h3><p>{proposal.rights}</p></div><div className="share-detail"><h3>Timeline & delivery</h3><p>{proposal.timeline}</p></div><div className="share-detail"><h3>Offer valid until</h3><p>{proposal.validUntil} · Asia/Kolkata. This link may expire earlier or be revoked.</p></div></section>
    {proposal.comments.length > 0 && <section className="share-card"><h2>Our conversation.</h2>{proposal.comments.map((item) => <article className="share-comment" key={item.id}><strong>{item.name}</strong><p>{item.text}</p>{item.expectedDate && <small>Preferred delivery: {item.expectedDate}</small>}{item.counterOffer && <small>Suggested budget: {formatMoney(item.counterOffer)}</small>}<small>{new Date(item.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}</small></article>)}</section>}
    </div><aside>
      {proposal.status === 'accepted' ? <section className="share-card"><div className="share-success"><CheckCircle2 size={31} strokeWidth={1.4} /><h2>It’s a lovely yes.</h2><p>Version {proposal.version} accepted by {proposal.acceptedBy}. Priya will coordinate the next steps with you.</p></div></section> : <>
      <section className="share-card"><Flower2 size={25} strokeWidth={1} style={{ color: '#a17a91', marginBottom: 14 }} /><h2>Feels like a good fit?</h2><p>If everything looks lovely, confirm the proposal below. Or leave a note to work through the details.</p>{accepting ? <form onSubmit={accept}><fieldset disabled={pending} style={{ border: 0, padding: 0, marginTop: 20 }}><label className="share-field">Your full name<input name="name" required maxLength={200} autoComplete="name" /></label><label className="share-checkbox"><input type="checkbox" required />I’m authorized to respond for {brandName} and agree to version {proposal.version}, including its deliverables, total, rights and timeline.</label><button className="button" disabled={pending}>{pending ? 'Confirming…' : 'Confirm acceptance'}</button><button type="button" className="button button-secondary" onClick={() => setAccepting(false)}>Keep reviewing</button></fieldset></form> : <button className="button" onClick={() => { setAccepting(true); setActionError(''); }}>Accept this proposal <ArrowUpRight size={16} /></button>}<p className="share-footnote">This records the name and version you provide. It is not verified identity or a digital-signature service.</p></section>
      <section className="share-card"><h2>Let’s talk details.</h2>{sent && <div className="share-success" role="status"><p>Your note is saved. Priya can see it in her studio.</p></div>}<form onSubmit={comment}><fieldset disabled={pending} style={{ border: 0, padding: 0 }}><label className="share-field">Your name<input name="name" autoComplete="name" required maxLength={200} /></label><label className="share-field">Your note<textarea name="text" required rows={4} maxLength={5000} placeholder="We love the idea! Could we explore…" /></label><label className="share-field">Preferred date <small>(optional)</small><input name="expectedDate" type="date" min={todayISO()} /></label><label className="share-field">Suggested total budget in ₹ <small>(optional)</small><input name="counterOffer" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="15000.00" /></label><button className="button button-secondary" disabled={pending}>{pending ? 'Saving your note…' : 'Send a little note'}<MessageCircle size={16} /></button></fieldset></form><p className="share-footnote">A comment or counter-offer does not change these terms or constitute acceptance.</p></section></>}
      {actionError && <p className="share-error" role="alert">{actionError}</p>}
    </aside></div></main></ShareFrame>;
}

export function PublicReview({ token }: { token: string }) {
  const url = `/api/public/review/${encodeURIComponent(token)}`;
  const { data, error } = useShare<ReviewView>(url);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [sent, setSent] = useState(false);
  if (!data) return <LoadingShare error={error} />;
  const { collaboration, brandName, creatorName, demo } = data;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setActionError(''); const form = event.currentTarget;
    try { await requestJSON(url, { method: 'POST', body: JSON.stringify({ name: input(form, 'name'), role: input(form, 'role'), text: input(form, 'text'), consent: new FormData(form).get('consent') === 'on' }) }); setSent(true); }
    catch (err) { setActionError(errorMessage(err)); }
    finally { setPending(false); }
  }
  return <ShareFrame><main><div className="share-intro"><span className="eyebrow">A NOTE FROM {brandName.toUpperCase()}</span><h1>How was our<br /><i>little collaboration?</i></h1><p>A few honest words mean the world.</p></div><div className="share-layout"><section className="share-card">{collaboration.image && <img className="review-visual" src={collaboration.image} alt={collaboration.title} width={600} height={400} />}<span className="eyebrow">{creatorName.toUpperCase()} × {brandName.toUpperCase()}</span><h2 style={{ marginTop: 12 }}>{collaboration.title}</h2><p>Thank you for creating something together. Share what working with {creatorName} was like — the process, the content, or the little things that stood out.</p>{collaboration.reelUrl && <a className="text-link" href={collaboration.reelUrl} target="_blank" rel="noreferrer">Revisit our reel <ArrowUpRight size={16} /></a>}</section><section className="share-card">{demo && <p className="share-notice">LOCAL DEMO · Submit example feedback only, not an endorsement attributed to a real person.</p>}{sent ? <div className="share-success" role="status"><CheckCircle2 size={34} strokeWidth={1.3} /><h2>A note worth keeping.</h2><p>Thank you! Your feedback has been saved for {creatorName} to review. It will only appear on the portfolio after approval.</p></div> : <><h2>Your honest words.</h2><form onSubmit={submit}><fieldset disabled={pending} style={{ border: 0, padding: 0 }}><label className="share-field">Your name<input name="name" required maxLength={200} autoComplete="name" /></label><label className="share-field">Your role <small>(optional)</small><input name="role" maxLength={200} placeholder="Brand manager" /></label><label className="share-field">Your experience<textarea name="text" required rows={6} maxLength={5000} placeholder="What did you enjoy about working together?" /></label><label className="share-checkbox"><input type="checkbox" name="consent" required />I have permission to share this feedback for {brandName}. I consent to the publication of this testimonial, my name and role on {creatorName}’s public portfolio after review.</label><button className="button" disabled={pending}>{pending ? 'Saving your words…' : 'Send your testimonial'}<ArrowUpRight size={16} /></button></fieldset>{actionError && <p className="share-error" role="alert">{actionError}</p>}</form><p className="share-footnote">Please don’t include confidential details. To request removal later, contact {creatorName} through her portfolio.</p></>}</section></div></main></ShareFrame>;
}