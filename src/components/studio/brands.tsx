'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Mail, Plus, UserRound } from 'lucide-react';
import type { Brand } from '@/lib/types';
import { Badge, EmptyState, ErrorNotice, Field, FormFooter, Modal, PageHeading, formText, useTask } from '@/components/ui/studio-primitives';
import { SimilarBrandNotice } from './forms';
import { matchesSearch, useStudio } from './store';

function BrandForm({ onClose, onOpenExisting }: { onClose: () => void; onOpenExisting: (brand: Brand) => void }) {
  const { state, mutate } = useStudio();
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const task = useTask();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const text = (name: string) => formText(event, name);
    const data = { id, name: text('name'), contact: text('contact'), email: text('email'), category: text('category'), notes: text('notes') };
    void task.run(async () => { await mutate({ type: 'brand.create', data }); onClose(); });
  }
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="A new creative connection." description="Keep the people behind your collaborations close." busy={task.pending}><form onSubmit={submit}><fieldset disabled={task.pending} className="studio-fieldset studio-form-grid"><Field label="Brand name"><input ref={nameInput} className="studio-input" name="name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="The name behind the story" /></Field><SimilarBrandNotice brands={state.brands} value={name} inputRef={nameInput} useLabel="Open" onUse={(brand) => { onClose(); onOpenExisting(brand); }} /><Field label="Category"><input className="studio-input" name="category" required maxLength={100} placeholder="Cafés, lifestyle, beauty…" /></Field><Field label="Contact person"><input className="studio-input" name="contact" maxLength={300} placeholder="Your friendly point of contact" /></Field><Field label="Contact email"><input className="studio-input" name="email" type="email" maxLength={254} placeholder="hello@brand.com" /></Field><Field label="A few notes" className="studio-span-2"><textarea className="studio-input" name="notes" rows={4} maxLength={5000} placeholder="Their style, your conversations, the little things to remember…" /></Field></fieldset><ErrorNotice message={task.error} /><FormFooter pending={task.pending} onCancel={onClose}>Add brand</FormFooter></form></Modal>;
}

export function BrandsPage() {
  const { state, search } = useStudio();
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const [selected, setSelected] = useState<Brand | null>(null);
  const brands = state.brands.filter((brand) => matchesSearch(search, brand.name, brand.category, brand.contact, brand.email, brand.notes));
  const create = <button className="studio-button" onClick={() => setOpen(true)}><Plus size={17} /> Add a brand</button>;
  return <><PageHeading eyebrow="GOOD PEOPLE. LOVELY POSSIBILITIES." title="Your circle of brands." description="Creative relationships, thoughtfully kept in one place." action={create} /><div className="studio-section-heading"><p className="studio-muted" role="status">{brands.length} {brands.length === 1 ? 'brand' : 'brands'} in your creative circle</p><span className="studio-eyebrow">BETTER TOGETHER</span></div>{brands.length ? <div className="studio-brand-grid">{brands.map((brand, index) => <article className="studio-brand-card" key={brand.id}><div className="studio-brand-top"><div className={`studio-brand-avatar studio-brand-color-${index % 4}`}>{brand.name.split(' ').slice(0, 2).map((word) => word[0]).join('')}</div><Badge>{brand.category}</Badge></div><h2><button onClick={() => setSelected(brand)}>{brand.name}</button></h2><div className="studio-brand-contact"><UserRound size={15} /><span>{brand.contact || 'A new connection in the making'}</span></div><div className="studio-brand-contact"><Mail size={15} />{brand.email ? <a href={`mailto:${brand.email}`}>{brand.email}</a> : <span>No contact email added</span>}</div><div className="studio-brand-bottom"><span>{state.collaborations.filter((item) => item.brandId === brand.id).length} collaborations</span><button className="studio-icon-button" aria-label={`View ${brand.name}`} onClick={() => setSelected(brand)}><ArrowRight size={18} /></button></div></article>)}</div> : <div className="studio-card"><EmptyState title={search ? 'No matching connections.' : 'Great stories start with a hello.'} description={search ? 'Try another name, category or contact.' : 'Add a brand to start creating collaborations and thoughtful proposals.'} action={create} /></div>}
    {open && <BrandForm onClose={() => setOpen(false)} onOpenExisting={setSelected} />}{selected && <Modal open onOpenChange={(value) => { if (!value) setSelected(null); }} title={selected.name} description={`${selected.category} · Your brand relationship`}><dl className="studio-detail-list"><div><dt>Contact</dt><dd>{selected.contact || 'Not added'}</dd></div><div><dt>Email</dt><dd>{selected.email ? <a href={`mailto:${selected.email}`}>{selected.email}</a> : 'Not added'}</dd></div><div><dt>Notes</dt><dd className="studio-preline">{selected.notes || 'A fresh page for your next conversation.'}</dd></div></dl><div className="studio-info-box"><strong>Stories together</strong><ul className="studio-simple-list">{state.collaborations.filter((item) => item.brandId === selected.id).map((item) => <li key={item.id}>{item.title}</li>)}</ul><Link className="studio-text-link" href="/studio/collaborations" onClick={() => setSelected(null)}>Go to collaborations <ArrowRight size={16} /></Link></div></Modal>}
  </>;
}