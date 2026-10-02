'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCheck, Copy, FileText, Link2, MessageCircle, Plus } from 'lucide-react';
import { formatMoney, todayISO } from '@/lib/domain';
import type { Proposal } from '@/lib/types';
import { Badge, EmptyState, ErrorNotice, Field, FormFooter, Modal, PageHeading, formText, prettyDate, useTask } from '@/components/ui/studio-primitives';
import { initialItems, LineItemsEditor, parseItems } from './forms';
import { ShareDialog } from './share-dialog';
import { matchesSearch, useStudio } from './store';

function ProposalForm({ source, onClose }: { source?: Proposal; onClose: () => void }) {
  const { state, mutate } = useStudio();
  const [id] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState(() => initialItems(source?.items));
  const task = useTask();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const text = (name: string) => formText(event, name);
    const fields = { id, brandId: text('brandId'), title: text('title'), rights: text('rights'), timeline: text('timeline'), validUntil: text('validUntil') };
    void task.run(async () => { await mutate({ type: 'proposal.create', data: { ...fields, items: parseItems(items) } }); onClose(); });
  }
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={source ? 'A fresh take, a new draft.' : 'Put a lovely idea on paper.'} description={source ? 'The original rate card and its acceptance history stay untouched.' : 'A considered proposal for a collaboration worth creating.'} wide busy={task.pending}>
    {!state.brands.length ? <EmptyState title="A proposal needs a partner." description="Add a brand first, then shape your offer around them." action={<Link className="studio-button" href="/studio/brands?new=1" onClick={onClose}>Add a brand <ArrowRight size={16} /></Link>} /> : <form onSubmit={submit}><fieldset disabled={task.pending} className="studio-fieldset"><div className="studio-form-grid"><Field label="For the brand"><select className="studio-input" name="brandId" defaultValue={source?.brandId ?? ''} required><option value="" disabled>Choose your brand</option>{state.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></Field><Field label="Valid until"><input className="studio-input" name="validUntil" type="date" required min={todayISO()} defaultValue={source && source.validUntil >= todayISO() ? source.validUntil : todayISO()} /></Field><Field label="Rate card title" className="studio-span-2"><input className="studio-input" name="title" maxLength={300} required defaultValue={source ? `${source.title.slice(0, 285)} · revised` : ''} placeholder="A new season of stories" /></Field></div><LineItemsEditor items={items} onChange={setItems} /><div className="studio-form-grid"><Field label="Usage rights" className="studio-span-2" hint="Be clear about organic use, duration, paid media and exclusivity."><textarea className="studio-input" name="rights" rows={3} maxLength={5000} defaultValue={source?.rights} placeholder="Organic social use only. Paid usage to be agreed separately." /></Field><Field label="Proposed timeline" className="studio-span-2" hint="A requested posting date is not a commitment until you confirm it."><textarea className="studio-input" name="timeline" rows={2} maxLength={2000} defaultValue={source?.timeline} placeholder="Concept approval, production and your preferred posting window…" /></Field></div></fieldset><ErrorNotice message={task.error} /><FormFooter pending={task.pending} onCancel={onClose}>Save as draft</FormFooter></form>}
  </Modal>;
}

function ProposalDetails({ proposal, onClose, onCopy, onShare }: { proposal: Proposal; onClose: () => void; onCopy: () => void; onShare: () => void }) {
  const { state } = useStudio();
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={proposal.title} description={`${state.brands.find((brand) => brand.id === proposal.brandId)?.name} · Version ${proposal.version} · ${proposal.status}`} wide>
    <div className="studio-document-meta"><Badge tone={proposal.status === 'accepted' ? 'sage' : proposal.status === 'sent' ? 'plum' : 'neutral'}>{proposal.status}</Badge><span>Valid until {prettyDate(proposal.validUntil, { year: 'numeric' })}</span></div><div className="studio-table-scroll" role="region" aria-label="Rate card deliverables" tabIndex={0}><table className="studio-table studio-document-table"><thead><tr><th>Deliverable</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{proposal.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.quantity}</td><td>{formatMoney(item.unitPrice)}</td><td>{formatMoney(item.quantity * item.unitPrice)}</td></tr>)}</tbody></table></div><div className="studio-document-total"><span>Proposed total</span><strong>{formatMoney(proposal.items.reduce((total, item) => total + item.quantity * item.unitPrice, 0))}</strong></div><dl className="studio-detail-list"><div><dt>Usage rights</dt><dd className="studio-preline">{proposal.rights || 'Not specified'}</dd></div><div><dt>Timeline</dt><dd className="studio-preline">{proposal.timeline || 'To be discussed'}</dd></div></dl>
    {proposal.status === 'accepted' && <div className="studio-acceptance"><CheckCheck size={23} /><div><strong>Version {proposal.version} accepted by {proposal.acceptedBy}</strong><p>{prettyDate(proposal.acceptedAt ?? '', { year: 'numeric', hour: '2-digit', minute: '2-digit' })}. This version is preserved exactly as accepted.</p></div></div>}
    <section className="studio-comments"><h3><MessageCircle size={18} /> The conversation <span className="studio-count">{proposal.comments.length}</span></h3>{proposal.comments.length ? proposal.comments.map((comment) => <article key={comment.id}><div><strong>{comment.name}</strong><time>{prettyDate(comment.createdAt, { year: 'numeric' })}</time></div><p className="studio-preline">{comment.text}</p>{comment.expectedDate && <p className="studio-comment-detail">Requested date: {prettyDate(comment.expectedDate, { year: 'numeric' })} · not confirmed</p>}{comment.counterOffer !== null && <p className="studio-comment-detail">Counter-offer: {formatMoney(comment.counterOffer)} · original pricing unchanged</p>}</article>) : <p className="studio-muted">A shared link gives your brand a place to ask questions, request a date, or accept this version.</p>}</section>
    <div className="studio-form-footer"><button className="studio-button studio-button-secondary" onClick={onCopy}><Copy size={16} /> Copy as new draft</button><button className="studio-button" onClick={onShare}><Link2 size={16} /> Share & manage links</button></div>
  </Modal>;
}

export function ProposalsPage() {
  const { state, search } = useStudio();
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [source, setSource] = useState<Proposal | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState('all');
  const [sort, setSort] = useState<'latest' | 'oldest'>('latest');
  const brandName = (id: string) => state.brands.find((brand) => brand.id === id)?.name ?? 'Brand';
  const proposals = state.proposals.filter((proposal) => (brandFilter === 'all' || proposal.brandId === brandFilter) && matchesSearch(search, proposal.title, brandName(proposal.brandId), proposal.status, proposal.rights));
  const sortedProposals = [...proposals].sort((a, b) => {
    if (sort === 'oldest') return (a.createdAt || '').localeCompare(b.createdAt || '');
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  const selectedProposal = state.proposals.find((item) => item.id === selected);
  const sharedProposal = state.proposals.find((item) => item.id === sharing);
  const create = <button className="studio-button" onClick={() => { setSource(undefined); setCreating(true); }}><Plus size={17} /> New rate card</button>;
  return <><PageHeading eyebrow="YOUR WORK HAS VALUE" title="Ideas, beautifully proposed." description="Thoughtful rate cards. Clear terms. Room for a conversation." action={create} /><div className="studio-toolbar"><label className="studio-filter"><span className="studio-sr-only">Filter rate cards by brand</span><select className="studio-input" value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}><option value="all">All brands</option>{state.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label><label className="studio-filter"><span className="studio-sr-only">Sort rate cards</span><select className="studio-input" value={sort} onChange={(event) => setSort(event.target.value as any)}><option value="latest">Sort: Latest first</option><option value="oldest">Sort: Oldest first</option></select></label><p className="studio-results-count" role="status">{sortedProposals.length} rate cards</p><span className="studio-toolbar-note">A little clarity goes a long way.</span></div>
    {sortedProposals.length ? <div className="studio-proposal-grid">{sortedProposals.map((proposal) => <article className="studio-proposal-card" key={proposal.id}><div className="studio-proposal-cover"><FileText size={29} strokeWidth={1} /><span className="studio-eyebrow">A NOTE TO {brandName(proposal.brandId)}</span><span className="studio-proposal-version">V.{proposal.version}</span></div><div className="studio-proposal-body"><div className="studio-work-kicker"><span>{brandName(proposal.brandId)}</span><Badge tone={proposal.status === 'accepted' ? 'sage' : proposal.status === 'sent' ? 'plum' : 'neutral'}>{proposal.status}</Badge></div><h2><button onClick={() => setSelected(proposal.id)}>{proposal.title}</button></h2><p>{proposal.items.length} {proposal.items.length === 1 ? 'deliverable' : 'deliverables'} · Valid until {prettyDate(proposal.validUntil)}</p><strong className="studio-proposal-price">{formatMoney(proposal.items.reduce((total, item) => total + item.unitPrice * item.quantity, 0))}</strong><div className="studio-proposal-actions"><button className="studio-button studio-button-secondary" onClick={() => setSelected(proposal.id)}>View details <ArrowRight size={16} /></button><button className="studio-icon-button" onClick={() => { setSource(proposal); setCreating(true); }} aria-label={`Copy ${proposal.title} as a new draft`}><Copy size={17} /></button><button className="studio-icon-button" onClick={() => setSharing(proposal.id)} aria-label={`Share ${proposal.title}`}><Link2 size={18} /></button></div></div></article>)}</div> : <div className="studio-card"><EmptyState title={state.proposals.length ? 'No rate cards in this view.' : 'The beginning of a beautiful yes.'} description={state.proposals.length ? 'Try a different brand or search term.' : 'Give your next collaboration a thoughtful starting point with a personalized rate card.'} action={create} /></div>}
    <p className="studio-page-footnote">Sent and accepted terms are preserved. Need to revise? Copy the original as a new draft, then share the new offer.</p>
    {creating && <ProposalForm source={source} onClose={() => { setCreating(false); setSource(undefined); }} />}{selectedProposal && <ProposalDetails proposal={selectedProposal} onClose={() => setSelected(null)} onCopy={() => { setSource(selectedProposal); setSelected(null); setCreating(true); }} onShare={() => { setSelected(null); setSharing(selectedProposal.id); }} />}{sharedProposal && <ShareDialog scope="proposal" targetId={sharedProposal.id} title={sharedProposal.title} onClose={() => setSharing(null)} />}
  </>;
}