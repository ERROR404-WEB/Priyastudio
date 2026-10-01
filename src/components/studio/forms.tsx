'use client';

import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { similarBrands } from '@/lib/brand-match';
import { paiseToInput, rupeesToPaise, uploadImage } from '@/lib/client';
import { formatMoney } from '@/lib/domain';
import type { Brand, Command, LineItem, StudioState } from '@/lib/types';
import { ErrorNotice, Field, useTask } from '@/components/ui/studio-primitives';

export const categorySuggestions = ['Cafés', 'Food', 'Lifestyle', 'Travel', 'Beauty', 'Fashion'];
type BrandOption = Pick<Brand, 'id' | 'name' | 'category'>;

export function findBrandByName<T extends { name: string }>(brands: readonly T[], name: string): T | undefined {
  const key = name.trim().toLocaleLowerCase();
  return key ? brands.find((brand) => brand.name.trim().toLocaleLowerCase() === key) : undefined;
}

/** Returns the matching brand's id, creating the brand first when the name is new. */
export async function ensureBrand(brands: readonly BrandOption[], name: string, category: string, mutate: (command: Command) => Promise<StudioState>, newId: string): Promise<BrandOption> {
  const existing = findBrandByName(brands, name);
  if (existing) return existing;
  const brand = { id: newId, name: name.trim(), category: category.trim() || 'Other' };
  await mutate({ type: 'brand.create', data: { ...brand, contact: '', email: '', notes: '' } });
  return brand;
}

/** Asks whether a typed brand is one that already exists; blocks form submission until answered. */
export function SimilarBrandNotice<T extends BrandOption>({ brands, value, inputRef, onUse, useLabel = 'Yes, use' }: {
  brands: readonly T[]; value: string; inputRef: RefObject<HTMLInputElement | null>; onUse: (brand: T) => void; useLabel?: string;
}) {
  const [confirmedNew, setConfirmedNew] = useState('');
  const key = value.trim().toLocaleLowerCase();
  const exact = findBrandByName(brands, value);
  const similar = exact ? [exact] : similarBrands(brands, value);
  const unresolved = similar.length > 0 && (Boolean(exact) || confirmedNew !== key);
  const message = exact ? `“${exact.name}” already exists.` : 'A brand with a similar name already exists. Choose it, or confirm this is a different brand.';
  useEffect(() => {
    const input = inputRef.current;
    input?.setCustomValidity(unresolved ? message : '');
    return () => input?.setCustomValidity('');
  }, [inputRef, unresolved, message]);
  if (!unresolved) return null;
  return <div className="studio-similar-brand" role="status">
    <p><strong>{exact ? 'This brand already exists.' : 'Is this the same brand?'}</strong> {exact ? '' : 'You already have:'}</p>
    <div className="studio-similar-actions">
      {similar.map((brand) => <button type="button" key={brand.id} className="studio-button studio-button-secondary" onClick={() => onUse(brand)}>{useLabel} “{brand.name}”</button>)}
      {!exact && <button type="button" className="studio-button studio-button-quiet" onClick={() => setConfirmedNew(key)}>No, “{value.trim()}” is a different brand</button>}
    </div>
  </div>;
}

/** Type to search existing brands, or type a new name to add it on save. */
export function BrandPicker({ brands, value, onChange, categoryName = 'brandCategory' }: { brands: readonly BrandOption[]; value: string; onChange: (value: string) => void; categoryName?: string }) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const match = findBrandByName(brands, value);
  const isNew = Boolean(value.trim()) && !match;
  const hint = !value.trim() ? 'Start typing to find a brand, or enter a new one.' : match ? `${match.name} · ${match.category}` : `New brand: “${value.trim()}” will be added to your brands when you save.`;
  return <>
    <Field label="Brand" hint={hint}><input ref={input} className="studio-input" name="brandName" list={listId} required maxLength={200} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Type or pick a brand" /><datalist id={listId}>{[...brands].sort((a, b) => a.name.localeCompare(b.name)).map((brand) => <option key={brand.id} value={brand.name} />)}</datalist></Field>
    {isNew && <SimilarBrandNotice brands={brands} value={value} inputRef={input} onUse={(brand) => onChange(brand.name)} />}
    {isNew && <Field label="Brand category" hint="Shown on your portfolio filters."><input className="studio-input" name={categoryName} list={`${listId}-categories`} required maxLength={100} placeholder="Cafés, lifestyle, beauty…" /><datalist id={`${listId}-categories`}>{categorySuggestions.map((category) => <option key={category} value={category} />)}</datalist></Field>}
  </>;
}

export interface ItemDraft { key: string; description: string; quantity: string; price: string }
export function initialItems(items?: LineItem[]): ItemDraft[] {
  return (items ?? [{ description: '', quantity: 1, unitPrice: 0 }]).map((item) => ({
    key: crypto.randomUUID(), description: item.description, quantity: String(item.quantity), price: item.unitPrice ? paiseToInput(item.unitPrice) : '',
  }));
}
export function parseItems(items: ItemDraft[]): LineItem[] {
  const parsed = items.map((item) => {
    const quantity = Number(item.quantity);
    if (!item.description.trim()) throw new Error('Give every line item a description.');
    if (!/^\d+$/.test(item.quantity) || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Quantities must be positive whole numbers.');
    const unitPrice = rupeesToPaise(item.price);
    if (BigInt(quantity) * BigInt(unitPrice) > 100_000_000_000n) throw new Error('A line item exceeds the supported money limit.');
    return { description: item.description.trim(), quantity, unitPrice };
  });
  if (!parsed.length || parsed.length > 100) throw new Error('Add between 1 and 100 line items.');
  if (parsed.reduce((sum, item) => sum + BigInt(item.quantity) * BigInt(item.unitPrice), 0n) > 100_000_000_000n) throw new Error('The document total exceeds the supported money limit.');
  return parsed;
}

export function LineItemsEditor({ items, onChange }: { items: ItemDraft[]; onChange: (items: ItemDraft[]) => void }) {
  function update(key: string, patch: Partial<ItemDraft>) { onChange(items.map((item) => item.key === key ? { ...item, ...patch } : item)); }
  let total: number | null = null;
  try { total = parseItems(items).reduce((sum, item) => sum + item.quantity * item.unitPrice, 0); } catch { /* Incomplete inputs are validated on submit. */ }
  return <section className="studio-line-editor" aria-label="Line items">
    <div className="studio-section-heading"><h3>The deliverables</h3><span className="studio-muted">INR · no tax added</span></div>
    {items.map((item, index) => <div className="studio-line-row" key={item.key}>
      <Field label={`Item ${index + 1} description`}><input className="studio-input" required maxLength={500} value={item.description} onChange={(event) => update(item.key, { description: event.target.value })} placeholder="One Instagram reel" /></Field>
      <Field label="Quantity"><input className="studio-input" required type="number" min="1" max="1000000000" step="1" value={item.quantity} onChange={(event) => update(item.key, { quantity: event.target.value })} /></Field>
      <Field label="Rate (₹)"><input className="studio-input" required inputMode="decimal" maxLength={16} pattern="[0-9]+(\.[0-9]{1,2})?" value={item.price} onChange={(event) => update(item.key, { price: event.target.value })} placeholder="5000.00" /></Field>
      <button type="button" className="studio-icon-button" aria-label={`Remove item ${index + 1}`} disabled={items.length === 1} onClick={() => onChange(items.filter((row) => row.key !== item.key))}><Trash2 size={17} /></button>
    </div>)}
    <div className="studio-line-bottom"><button type="button" className="studio-button studio-button-quiet" disabled={items.length >= 100} onClick={() => onChange([...items, ...initialItems()])}><Plus size={17} /> Add line item</button><strong>{total === null ? 'Complete items for total' : `Total ${formatMoney(total)}`}</strong></div>
  </section>;
}

export function ImageUpload({ value, onChange, onBusyChange }: { value: string; onChange: (value: string) => void; onBusyChange: (busy: boolean) => void }) {
  const task = useTask();
  const id = useId();
  const [filename, setFilename] = useState('');
  return <div className="studio-upload"><label htmlFor={id} className="studio-label">Cover photograph</label><div className="studio-upload-box"><ImagePlus size={24} strokeWidth={1.4} /><div><strong>{task.pending ? 'Uploading your photograph…' : filename || (value ? 'Cover photograph added' : 'A little visual inspiration')}</strong><p>JPEG, PNG or WebP · up to 4 MiB</p></div></div>
    <p className="studio-field-hint">Uploading makes this photograph public immediately, even before you publish a collaboration. Do not upload private documents or confidential images. Remove location metadata before uploading.</p>
    <input id={id} className="studio-input studio-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={task.pending} onChange={(event) => {
      const file = event.target.files?.[0]; if (!file) return;
      const input = event.target;
      onBusyChange(true);
      void task.run(async () => { try { const url = await uploadImage(file); onChange(url); setFilename(file.name); } finally { onBusyChange(false); input.value = ''; } });
    }} />
    {value && <button type="button" className="studio-button studio-button-quiet" disabled={task.pending} onClick={() => { onChange(''); setFilename(''); }}>Remove cover photograph</button>}
    <ErrorNotice message={task.error} />
  </div>;
}