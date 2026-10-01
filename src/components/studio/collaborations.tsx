'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CalendarDays, Columns3, LayoutGrid, List, Pencil, Plus } from 'lucide-react';
import { stageLabels, stages, type Collaboration, type Stage } from '@/lib/types';
import { Badge, EmptyState, ErrorNotice, Field, FormFooter, Modal, PageHeading, formText, prettyDate, useTask } from '@/components/ui/studio-primitives';
import { BrandPicker, ImageUpload, categorySuggestions, ensureBrand } from './forms';
import { WorkImage } from './overview';
import { matchesSearch, useStudio } from './store';

function CollaborationForm({ item, onClose }: { item?: Collaboration; onClose: () => void }) {
  const { state, mutate } = useStudio();
  const task = useTask();
  const [id] = useState(() => item?.id ?? crypto.randomUUID());
  const [newBrandId] = useState(() => crypto.randomUUID());
  const [brandName, setBrandName] = useState('');
  const [image, setImage] = useState(item?.image ?? '');
  const [uploading, setUploading] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = (name: string) => formText(event, name);
    const data = { stage: text('stage') as Stage, dueDate: text('dueDate'), image, reelUrl: text('reelUrl'), description: text('description') };
    const title = text('title'); const chosenCategory = text('category'); const brandCategory = text('brandCategory');
    const published = new FormData(event.currentTarget).get('published') === 'on';
    void task.run(async () => {
      if (item) await mutate({ type: 'collaboration.update', id, data: { ...data, published } });
      else {
        const brand = await ensureBrand(state.brands, brandName, brandCategory || chosenCategory, mutate, newBrandId);
        await mutate({ type: 'collaboration.create', data: { id, brandId: brand.id, title, category: chosenCategory || brand.category, ...data } });
      }
      onClose();
    });
  }
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={item ? 'Edit collaboration' : 'Add collaboration'} description={item ? `Update ${item.title}.` : 'Pick a brand or type a new one, then add a title. You can add dates, details and payments later.'} wide busy={task.pending || uploading}>
    <form onSubmit={submit}><fieldset disabled={task.pending || uploading} className="studio-fieldset"><div className="studio-form-grid">
      {!item ? <>
        <BrandPicker brands={state.brands} value={brandName} onChange={setBrandName} />
        <Field label="Collaboration title"><input className="studio-input" name="title" maxLength={300} required placeholder="October café reel" /></Field>
      </> : <div className="studio-info-box studio-span-2"><strong>{item.title}</strong><p>{state.brands.find((brand) => brand.id === item.brandId)?.name} · {item.category}</p></div>}
      <Field label="Stage"><select className="studio-input" name="stage" defaultValue={item?.stage ?? 'yet_to_visit'}>{stages.map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select></Field>
      <details className="studio-span-2"><summary>Optional details</summary><div className="studio-form-grid">
        {!item && <Field label="Category (optional)" hint="Uses the brand’s category if left blank."><input className="studio-input" name="category" maxLength={100} list="studio-categories" placeholder="Use brand category" /><datalist id="studio-categories">{categorySuggestions.map((category) => <option key={category}>{category}</option>)}</datalist></Field>}
        <Field label="Posting deadline (optional)"><input className="studio-input" type="date" name="dueDate" defaultValue={item?.dueDate ?? ''} /></Field>
        <Field label="Notes & deliverables (optional)" className="studio-span-2"><textarea className="studio-input" name="description" rows={3} maxLength={5000} defaultValue={item?.description} placeholder="What you’ll create for this brand" /></Field>
        <Field label="Instagram reel or post URL (optional)" hint="Use https://www.instagram.com/reel/… or /p/…" className="studio-span-2"><input className="studio-input" type="url" name="reelUrl" maxLength={2048} defaultValue={item?.reelUrl} placeholder="https://www.instagram.com/reel/…" /></Field>
        <div className="studio-span-2"><ImageUpload value={image} onChange={setImage} onBusyChange={setUploading} /></div>
      </div></details>
      {item && <label className="studio-check studio-span-2"><input type="checkbox" name="published" defaultChecked={item.published} /><span><strong>Show on my public portfolio</strong><small>Publishing is a separate choice from your production stage.</small></span></label>}
    </div></fieldset><ErrorNotice message={task.error} /><FormFooter pending={task.pending} disabled={uploading} onCancel={onClose}>{item ? 'Save changes' : 'Create collaboration'}</FormFooter></form>
  </Modal>;
}

export function CollaborationsPage() {
  const { state, search, mutate, pending } = useStudio();
  const params = useSearchParams();
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<Collaboration | null>(null);
  const [category, setCategory] = useState('All categories');
  const [view, setView] = useState<'grid' | 'list' | 'board'>('grid');
  const task = useTask();
  const brandName = (id: string) => state.brands.find((brand) => brand.id === id)?.name ?? 'Brand';
  const items = state.collaborations.filter((item) => (category === 'All categories' || category === item.category) && matchesSearch(search, item.title, item.description, item.category, stageLabels[item.stage], brandName(item.brandId)));
  const newButton = <button className="studio-button" onClick={() => setCreateOpen(true)}><Plus size={17} /> New collaboration</button>;
  function stageControl(item: Collaboration) { return <label className="studio-stage-control"><span className="studio-sr-only">Production stage for {item.title}</span><select className="studio-input" value={item.stage} disabled={pending} onChange={(event) => void task.run(async () => { await mutate({ type: 'collaboration.update', id: item.id, data: { stage: event.target.value as Stage } }); })}>{stages.map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select></label>; }
  function workCard(item: Collaboration, board = false) { return <article className={`studio-work-card${board ? ' studio-board-card' : ''}`} key={item.id}><button className="studio-image-button" onClick={() => setEditing(item)} aria-label={`Edit ${item.title}`}><WorkImage src={item.image} title={item.title} /></button><div className="studio-work-card-body"><div className="studio-work-kicker"><span>{brandName(item.brandId)}</span><Badge tone={item.published ? 'sage' : 'neutral'}>{item.published ? 'Public' : 'Private'}</Badge></div><h3><button onClick={() => setEditing(item)}>{item.title}</button></h3><p className="studio-work-category">{item.category}</p>{board ? stageControl(item) : <Badge tone={item.stage === 'posted' ? 'sage' : 'plum'}>{stageLabels[item.stage]}</Badge>}<div className="studio-work-card-footer"><span><CalendarDays size={14} /> {prettyDate(item.dueDate)}</span><button className="studio-icon-button" onClick={() => setEditing(item)} aria-label={`Edit ${item.title}`}><Pencil size={16} /></button></div></div></article>; }
  return <><PageHeading eyebrow="COLLABORATIONS" title="Collaborations" description="Track visits, content and posting. Add details when you need them." action={newButton} /><div className="studio-toolbar"><label className="studio-filter"><span className="studio-sr-only">Filter collaborations by category</span><select className="studio-input" value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option>{[...new Set(state.collaborations.map((item) => item.category))].sort().map((category) => <option key={category}>{category}</option>)}</select></label><span className="studio-results-count" role="status">{items.length} {items.length === 1 ? 'collaboration' : 'collaborations'}</span><div className="studio-view-switch" aria-label="Collaboration view">{([{ value: 'grid', icon: LayoutGrid, label: 'Grid view' }, { value: 'list', icon: List, label: 'List view' }, { value: 'board', icon: Columns3, label: 'Board view' }] as const).map(({ value, icon: Icon, label }) => <button key={value} className={view === value ? 'studio-view-active' : ''} aria-label={label} aria-pressed={view === value} onClick={() => setView(value)}><Icon size={18} /></button>)}</div></div><ErrorNotice message={task.error} />
    {!items.length ? <div className="studio-card"><EmptyState title={state.collaborations.length ? 'No stories found in this corner.' : 'Your next chapter is a blank canvas.'} description={state.collaborations.length ? 'Try another search or category to find your collaboration.' : 'Add your first collaboration and give that lovely idea a place to grow.'} action={newButton} /></div> : view === 'grid' ? <div className="studio-work-grid">{items.map((item) => workCard(item))}</div> : view === 'board' ? <div className="studio-board" role="region" aria-label="Production board; scroll horizontally to view all stages" tabIndex={0}>{stages.map((stage) => <section className="studio-board-column" key={stage}><h2><span className={`studio-stage-dot studio-stage-${stage}`} />{stageLabels[stage]}<span>{items.filter((item) => item.stage === stage).length}</span></h2>{items.filter((item) => item.stage === stage).map((item) => workCard(item, true))}{!items.some((item) => item.stage === stage) && <p className="studio-board-empty">Room for the next story.</p>}</section>)}</div> : <div className="studio-card studio-table-scroll" role="region" aria-label="Collaboration list" tabIndex={0}><table className="studio-table"><thead><tr><th>Collaboration</th><th>Category</th><th>Production stage</th><th>Due date</th><th>Portfolio</th><th>Details</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><button className="studio-table-work" onClick={() => setEditing(item)}><WorkImage src={item.image} title={item.title} small /><span><strong>{item.title}</strong><small>{brandName(item.brandId)}</small></span></button></td><td>{item.category}</td><td>{stageControl(item)}</td><td>{prettyDate(item.dueDate)}</td><td><Badge tone={item.published ? 'sage' : 'neutral'}>{item.published ? 'Public' : 'Private'}</Badge></td><td><button className="studio-icon-button" aria-label={`Edit ${item.title}`} onClick={() => setEditing(item)}><Pencil size={17} /></button></td></tr>)}</tbody></table></div>}
    {createOpen && <CollaborationForm onClose={() => setCreateOpen(false)} />}{editing && <CollaborationForm item={editing} onClose={() => setEditing(null)} />}
  </>;
}