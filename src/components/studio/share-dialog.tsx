'use client';

import { Check, Copy, Link2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, ErrorNotice, Modal, prettyDate, useTask } from '@/components/ui/studio-primitives';
import { useStudio } from './store';

export function ShareDialog({ targetId, scope, title, onClose }: { targetId: string; scope: 'proposal' | 'review'; title: string; onClose: () => void }) {
  const { state, share, mutate } = useStudio();
  const task = useTask();
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const links = state.shares.filter((link) => link.targetId === targetId && link.scope === scope);
  return <><Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={scope === 'proposal' ? 'Send a little possibility.' : 'A kind word, in their own words.'} description={`${title} · ${scope === 'proposal' ? 'A private rate-card review link.' : 'A private link to request an honest review.'}`} busy={task.pending}>
    <div className="studio-info-box"><ShieldCheck size={22} /><p>{scope === 'proposal' ? 'Creating a link sends this version. Its prices and terms remain unchanged; create a new draft for revisions.' : 'Reviews stay private until the brand gives consent and you approve them. No endorsements are created for you.'}</p><p>Only share with your intended recipient. Creating a new link revokes earlier links for this item.</p></div>
    <ErrorNotice message={task.error} />
    {url && <div className="studio-share-url"><label htmlFor="studio-share-url">Your private link</label><input id="studio-share-url" className="studio-input" value={url} readOnly onFocus={(event) => event.currentTarget.select()} /><button className="studio-button studio-button-secondary" onClick={() => void task.run(async () => {
      setCopied(false);
      if (!navigator.clipboard) throw new Error('Clipboard access is unavailable. Select and copy the link above instead.');
      try { await navigator.clipboard.writeText(url); setCopied(true); }
      catch { throw new Error('Could not copy automatically. Select and copy the link above instead.'); }
    })} disabled={task.pending}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied to clipboard' : 'Copy link'}</button><p role="status">{copied ? 'Link copied. It’s ready to send.' : 'You can also select the URL and copy it manually.'}</p></div>}
    <button className="studio-button studio-share-create" disabled={task.pending} onClick={() => void task.run(async () => { setCopied(false); const nextUrl = await share(targetId, scope); setUrl(nextUrl); })}><Link2 size={17} />{task.pending ? 'Working…' : url || links.length ? 'Create a replacement link' : 'Create private link'}</button>
    {links.length > 0 && <section className="studio-link-history"><h3>Link history</h3>{[...links].reverse().map((link) => <div key={link.id}><span><strong>{link.revokedAt ? 'Revoked' : Date.parse(link.expiresAt) <= openedAt ? 'Expired' : 'Active link'}</strong><small>Expires {prettyDate(link.expiresAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span>{!link.revokedAt && Date.parse(link.expiresAt) > openedAt && <button className="studio-button studio-button-quiet" disabled={task.pending} onClick={() => setRevoking(link.id)}>Revoke</button>}</div>)}</section>}
  </Modal>{revoking && <ConfirmDialog title="Close this private link?" description="The recipient will no longer be able to use it. Existing feedback and acceptance history stay in your studio." confirmLabel="Revoke link" onClose={() => setRevoking(null)} onConfirm={async () => { await mutate({ type: 'share.revoke', id: revoking }); setUrl(''); setCopied(false); }} />}</>;
}