import { z } from 'zod';
import type { Collaboration, CollaborationBalance, Command, Dashboard, Invoice, Payment, PublicPortfolio, StudioState } from './types';

const MAX_AMOUNT = 100_000_000_000;
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const text = (max: number) => z.string().max(max);
const requiredText = (max: number) => text(max).refine((value) => value.trim().length > 0, 'Must not be blank');
const amountSchema = z.number().int().positive().max(MAX_AMOUNT);
const pendingSchema = z.number().int().nonnegative().max(MAX_AMOUNT);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}, 'Expected a real ISO calendar date');
const timestampSchema = z.iso.datetime({ offset: true }).refine(
  (value) => dateSchema.safeParse(value.slice(0, 10)).success && Number.isFinite(Date.parse(value)),
  'Expected a real ISO timestamp with timezone',
);
const nowSchema = z.union([dateSchema, timestampSchema]);
const optionalDateSchema = z.union([z.literal(''), dateSchema]);
const emailSchema = z.union([z.literal(''), z.email().max(254)]);
const stageSchema = z.enum(['yet_to_visit', 'yet_to_record', 'recorded', 'yet_to_edit', 'edited', 'yet_to_post', 'posted']);

function httpsURL(value: string): URL | undefined {
  if (value.trim() !== value || /[\s\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : undefined;
  } catch {
    return undefined;
  }
}

// Hosted uploads are brokered through /api/media; only these external image CDNs are accepted.
const imageSchema = text(2048).refine((value) => {
  if (!value) return true;
  if (/^\/api\/media\/[A-Za-z0-9_-]+$/.test(value)) return true;
  if (/^\/images\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..')) return true;
  const url = httpsURL(value);
  return !!url && ['images.unsplash.com', 'images.pexels.com'].includes(url.hostname);
}, 'Image must be a safe local image or an approved HTTPS image CDN');
const reelSchema = text(2048).refine((value) => {
  if (!value) return true;
  const url = httpsURL(value);
  return !!url && url.hostname === 'www.instagram.com' && /^\/(reel|p)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
}, 'Use an HTTPS www.instagram.com/reel/ or /p/ link');
const instagramSchema = text(2048).refine((value) => {
  const url = httpsURL(value);
  return !!url && ['instagram.com', 'www.instagram.com'].includes(url.hostname);
}, 'Use an HTTPS Instagram URL');
const plainTextSchema = requiredText(5000).refine((value) => !/<\/?[a-z][^>]*>/i.test(value), 'Use plain text, not HTML');

const lineItemSchema = z.object({
  description: requiredText(500), quantity: amountSchema, unitPrice: amountSchema,
}).strict().refine((item) => BigInt(item.quantity) * BigInt(item.unitPrice) <= BigInt(MAX_AMOUNT), 'Line total exceeds the money limit');
const itemsSchema = z.array(lineItemSchema).min(1).max(100).refine(
  (items) => items.every((item) => Number.isSafeInteger(item.quantity) && Number.isSafeInteger(item.unitPrice))
    && items.reduce((sum, item) => sum + BigInt(item.quantity) * BigInt(item.unitPrice), 0n) <= BigInt(MAX_AMOUNT),
  'Document total exceeds the money limit',
);
const brandDataSchema = z.object({
  id: idSchema, name: requiredText(200), contact: text(300), email: emailSchema,
  category: requiredText(100), notes: text(5000),
}).strict();
const collaborationDataSchema = z.object({
  id: idSchema, brandId: idSchema, title: requiredText(300), category: requiredText(100),
  stage: stageSchema, dueDate: optionalDateSchema, image: imageSchema, reelUrl: reelSchema, description: text(5000),
  expectedPayment: pendingSchema.optional(),
}).strict();
const invoiceFields = {
  id: idSchema, brandId: idSchema, collaborationId: idSchema, billTo: text(5000), issuer: text(5000),
  items: itemsSchema, issueDate: dateSchema, dueDate: dateSchema, notes: text(5000),
};
const invoiceDatesOrdered = (invoice: { issueDate: string; dueDate: string }) => invoice.dueDate >= invoice.issueDate;
const invoiceDataSchema = z.object(invoiceFields).strict().refine(invoiceDatesOrdered, 'Due date cannot precede issue date');
const paymentDataSchema = z.object({
  id: idSchema, invoiceId: z.union([z.literal(''), idSchema]), collaborationId: idSchema.optional(), amount: amountSchema, date: dateSchema,
  method: requiredText(100), reference: text(300),
}).strict().refine((payment) => payment.invoiceId ? payment.collaborationId === undefined : !!payment.collaborationId,
  'Use either an invoice or a direct collaboration, never both');
const proposalDataSchema = z.object({
  id: idSchema, brandId: idSchema, title: requiredText(300), items: itemsSchema,
  rights: text(5000), timeline: text(2000), validUntil: dateSchema,
}).strict();
const commentDataSchema = z.object({
  id: idSchema, name: requiredText(200), text: plainTextSchema,
  expectedDate: optionalDateSchema, counterOffer: amountSchema.nullable(),
}).strict();
const shareDataSchema = z.object({
  id: idSchema, targetId: idSchema, scope: z.enum(['proposal', 'review']),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: timestampSchema,
}).strict();
const testimonialDataSchema = z.object({
  id: idSchema, collaborationId: idSchema, name: requiredText(200), role: text(200),
  text: plainTextSchema, consent: z.boolean(),
}).strict();
const profileSchema = z.object({
  name: requiredText(200), tagline: text(300), bio: text(5000), email: z.email().max(254),
  instagram: instagramSchema, location: text(200), issuerDetails: text(5000), paymentDetails: text(5000),
}).strict();
const collaborationPatchSchema = z.object({
  stage: stageSchema, dueDate: optionalDateSchema, image: imageSchema, reelUrl: reelSchema,
  description: text(5000), published: z.boolean(),
}).partial().strict().refine((data) => Object.values(data).some((value) => value !== undefined), 'An update must contain a value');

/** Validate untrusted commands at every caller boundary; system-managed fields are never accepted. */
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('brand.create'), data: brandDataSchema }).strict(),
  z.object({ type: z.literal('brand.delete'), id: idSchema }).strict(),
  z.object({ type: z.literal('collaboration.create'), data: collaborationDataSchema }).strict(),
  z.object({ type: z.literal('collaboration.update'), id: idSchema, data: collaborationPatchSchema }).strict(),
  z.object({ type: z.literal('collaboration.delete'), id: idSchema }).strict(),
  z.object({ type: z.literal('collaboration.payment-plan'), id: idSchema, pending: pendingSchema }).strict(),
  z.object({ type: z.literal('invoice.create'), data: invoiceDataSchema }).strict(),
  z.object({ type: z.literal('invoice.issue'), id: idSchema }).strict(),
  z.object({ type: z.literal('invoice.void'), id: idSchema }).strict(),
  z.object({ type: z.literal('payment.create'), data: paymentDataSchema }).strict(),
  z.object({ type: z.literal('payment.reverse'), id: idSchema }).strict(),
  z.object({ type: z.literal('proposal.create'), data: proposalDataSchema }).strict(),
  z.object({ type: z.literal('proposal.comment'), id: idSchema, data: commentDataSchema }).strict(),
  z.object({ type: z.literal('proposal.accept'), id: idSchema, version: z.number().int().positive(), name: requiredText(200) }).strict(),
  z.object({ type: z.literal('share.create'), data: shareDataSchema }).strict(),
  z.object({ type: z.literal('share.revoke'), id: idSchema }).strict(),
  z.object({ type: z.literal('testimonial.create'), data: testimonialDataSchema }).strict(),
  z.object({ type: z.literal('testimonial.approve'), id: idSchema, approved: z.boolean() }).strict(),
  z.object({ type: z.literal('profile.update'), data: profileSchema }).strict(),
]);

const brandSchema = brandDataSchema.extend({ createdAt: timestampSchema });
const collaborationSchema = collaborationDataSchema.extend({ published: z.boolean(), createdAt: timestampSchema });
const publicCollaborationSchema = collaborationSchema.pick({
  id: true, brandId: true, title: true, category: true, stage: true, dueDate: true,
  image: true, reelUrl: true, description: true, published: true, createdAt: true,
});
const invoiceSchema = z.object({
  ...invoiceFields, number: text(100), status: z.enum(['draft', 'issued', 'void']), createdAt: timestampSchema,
}).strict().refine(invoiceDatesOrdered, 'Due date cannot precede issue date');
const paymentSchema = paymentDataSchema.safeExtend({ createdAt: timestampSchema, reversedAt: timestampSchema.optional() });
const proposalSchema = proposalDataSchema.extend({
  version: z.number().int().positive(), status: z.enum(['draft', 'sent', 'accepted']),
  comments: z.array(commentDataSchema.extend({ createdAt: timestampSchema })),
  acceptedBy: requiredText(200).optional(), acceptedAt: timestampSchema.optional(), createdAt: timestampSchema,
});
const testimonialSchema = testimonialDataSchema.extend({ approved: z.boolean(), createdAt: timestampSchema });
const shareSchema = shareDataSchema.extend({ createdAt: timestampSchema, revokedAt: timestampSchema.optional() });
const stateSchema = z.object({
  revision: z.number().int().nonnegative(), profile: profileSchema,
  brands: z.array(brandSchema), collaborations: z.array(collaborationSchema), invoices: z.array(invoiceSchema),
  payments: z.array(paymentSchema), proposals: z.array(proposalSchema), testimonials: z.array(testimonialSchema),
  shares: z.array(shareSchema), audit: z.array(z.object({
    id: idSchema, action: requiredText(100), actor: requiredText(300), targetId: idSchema, at: timestampSchema,
  }).strict()),
}).strict();

function timestamp(now?: string): string {
  return new Date(nowSchema.parse(now ?? new Date().toISOString())).toISOString();
}
function businessDate(now: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Today's business-calendar date, independent of the machine's local timezone. */
export function todayISO(): string {
  return businessDate(timestamp());
}

function find<T extends { id: string }>(items: T[], id: string, kind: string): T {
  const item = items.find((item) => item.id === id);
  if (!item) throw new Error(`${kind} not found`);
  return item;
}
function unique(items: { id: string }[], id: string): void {
  if (items.some((item) => item.id === id)) throw new Error('ID already exists');
}
function safeSum(values: number[]): number {
  return z.number().int().nonnegative().parse(values.reduce((sum, value) => sum + value, 0));
}
function total(invoice: Pick<Invoice, 'items'>): number {
  return safeSum(invoice.items.map((item) => item.quantity * item.unitPrice));
}
function paid(invoice: Invoice, payments: Payment[]): number {
  if (invoice.status !== 'issued') return 0;
  return safeSum(payments.filter((payment) => payment.invoiceId === invoice.id && !payment.reversedAt).map((payment) => payment.amount));
}
function directReceived(collaboration: Collaboration, payments: Payment[]): number {
  return safeSum(payments.filter((payment) => !payment.invoiceId && payment.collaborationId === collaboration.id && !payment.reversedAt).map((payment) => payment.amount));
}
function directTracking(collaboration: Collaboration, payments: Payment[]): boolean {
  return collaboration.expectedPayment !== undefined || directReceived(collaboration, payments) > 0;
}
function issuedFor(collaboration: Collaboration, invoices: Invoice[]): Invoice[] {
  return invoices.filter((invoice) => invoice.collaborationId === collaboration.id && invoice.status === 'issued');
}
function balance(collaboration: Collaboration, invoices: Invoice[], payments: Payment[]): CollaborationBalance {
  const issued = issuedFor(collaboration, invoices);
  if (issued.length && directTracking(collaboration, payments)) throw new Error('Direct tracking cannot be mixed with issued invoice accounting');
  const received = issued.length ? safeSum(issued.map((invoice) => paid(invoice, payments))) : directReceived(collaboration, payments);
  const expected = issued.length ? safeSum(issued.map(total)) : collaboration.expectedPayment ?? null;
  if (expected !== null && received > expected) throw new Error('Collaboration is overpaid');
  return { source: issued.length ? 'invoice' : 'direct', received, expected, pending: expected === null ? null : expected - received };
}

/** Issued invoices take their original accounting path; absent direct targets remain unknown. */
export function collaborationBalance(collaboration: Collaboration, invoices: Invoice[], payments: Payment[]): CollaborationBalance {
  return balance(collaborationSchema.parse(collaboration), z.array(invoiceSchema).parse(invoices), z.array(paymentSchema).parse(payments));
}

/** A zero target is still an explicit plan. Reversed, unplanned receipts are history only. */
export function collaborationUsesDirectTracking(collaboration: Collaboration, payments: Payment[]): boolean {
  return directTracking(collaborationSchema.parse(collaboration), z.array(paymentSchema).parse(payments));
}

function validateRelationships(state: StudioState): void {
  for (const records of [state.brands, state.collaborations, state.invoices, state.payments, state.proposals, state.testimonials, state.shares, state.audit]) {
    if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error('Duplicate stored IDs');
  }
  const numbers = state.invoices.map((invoice) => invoice.number).filter(Boolean);
  if (new Set(numbers).size !== numbers.length) throw new Error('Duplicate invoice numbers');
  for (const collaboration of state.collaborations) {
    find(state.brands, collaboration.brandId, 'Brand');
    balance(collaboration, state.invoices, state.payments);
  }
  for (const invoice of state.invoices) {
    find(state.brands, invoice.brandId, 'Brand');
    const collaboration = find(state.collaborations, invoice.collaborationId, 'Collaboration');
    if (collaboration.brandId !== invoice.brandId) throw new Error('Invoice and collaboration brands must match');
    if (invoice.status === 'issued' && (!invoice.number || !invoice.issuer.trim() || !invoice.billTo.trim())) throw new Error('Issued invoice snapshot is incomplete');
    if (paid(invoice, state.payments) > total(invoice)) throw new Error('Invoice is overpaid');
  }
  for (const payment of state.payments) {
    if (payment.invoiceId) {
      const invoice = find(state.invoices, payment.invoiceId, 'Invoice');
      if (invoice.status === 'draft' || (invoice.status === 'void' && !payment.reversedAt)) throw new Error('Receipts require an issued invoice');
    } else {
      find(state.collaborations, payment.collaborationId!, 'Collaboration');
    }
  }
  for (const proposal of state.proposals) {
    find(state.brands, proposal.brandId, 'Brand');
    if (new Set(proposal.comments.map((comment) => comment.id)).size !== proposal.comments.length) throw new Error('Duplicate comment IDs');
    if (proposal.status === 'accepted' && (!proposal.acceptedBy || !proposal.acceptedAt)) throw new Error('Accepted proposal is incomplete');
  }
  for (const testimonial of state.testimonials) {
    find(state.collaborations, testimonial.collaborationId, 'Collaboration');
    if (testimonial.approved && !testimonial.consent) throw new Error('Public testimonial requires consent');
  }
  for (const share of state.shares) {
    if (share.scope === 'proposal') find(state.proposals, share.targetId, 'Proposal');
    else find(state.collaborations, share.targetId, 'Collaboration');
  }
  if (new Set(state.shares.map((share) => share.tokenHash)).size !== state.shares.length) throw new Error('Duplicate share hashes');
}

export function invoiceTotal(invoice: Invoice): number {
  return total(invoiceSchema.parse(invoice));
}
export function invoicePaid(invoice: Invoice, payments: Payment[]): number {
  return paid(invoiceSchema.parse(invoice), z.array(paymentSchema).parse(payments));
}
export function invoiceStatus(invoice: Invoice, payments: Payment[], today?: string): 'draft' | 'void' | 'unpaid' | 'partial' | 'paid' | 'overdue' {
  const document = invoiceSchema.parse(invoice);
  const receipts = z.array(paymentSchema).parse(payments);
  const day = dateSchema.parse(today ?? todayISO());
  if (document.status === 'draft' || document.status === 'void') return document.status;
  const received = paid(document, receipts);
  if (received >= total(document)) return 'paid';
  if (document.dueDate < day) return 'overdue';
  return received > 0 ? 'partial' : 'unpaid';
}

/** No IO or caller-origin assumptions. Authentication, capability checks and CAS persistence belong to the server. */
export function applyCommand(state: StudioState, command: Command, actor: string, now?: string): StudioState {
  // Zod produces detached nested objects; never mutate state or the caller's command payload.
  const next: StudioState = stateSchema.parse(state);
  const input = commandSchema.parse(command);
  const by = requiredText(300).parse(actor);
  const at = timestamp(now);
  const day = businessDate(at);
  validateRelationships(next);
  let targetId: string;

  switch (input.type) {
    case 'brand.create':
      unique(next.brands, input.data.id);
      next.brands.push({ ...input.data, createdAt: at });
      targetId = input.data.id;
      break;
    case 'brand.delete': {
      find(next.brands, input.id, 'Brand');
      if (next.collaborations.some((c) => c.brandId === input.id)) {
        throw new Error('Cannot delete a brand with existing collaborations. Delete its collaborations first.');
      }
      if (next.proposals.some((p) => p.brandId === input.id)) {
        throw new Error('Cannot delete a brand with active proposals. Delete its proposals first.');
      }
      if (next.invoices.some((i) => i.brandId === input.id && i.status !== 'void')) {
        throw new Error('Cannot delete a brand with active invoices');
      }
      next.invoices = next.invoices.filter((i) => i.brandId !== input.id);
      next.proposals = next.proposals.filter((p) => p.brandId !== input.id);
      next.brands = next.brands.filter((b) => b.id !== input.id);
      targetId = input.id;
      break;
    }
    case 'collaboration.create':
      unique(next.collaborations, input.data.id);
      find(next.brands, input.data.brandId, 'Brand');
      next.collaborations.push({ ...input.data, published: false, createdAt: at });
      targetId = input.data.id;
      break;
    case 'collaboration.update': {
      const collaboration = find(next.collaborations, input.id, 'Collaboration');
      // Explicit undefined is legal in JS Partial<T>, but must not erase stored fields.
      Object.assign(collaboration, Object.fromEntries(Object.entries(input.data).filter(([, value]) => value !== undefined)));
      targetId = input.id;
      break;
    }
    case 'collaboration.delete': {
      find(next.collaborations, input.id, 'Collaboration');
      if (next.invoices.some((i) => i.collaborationId === input.id && i.status !== 'void')) {
        throw new Error('Cannot delete a collaboration with active invoices');
      }
      if (next.payments.some((p) => p.collaborationId === input.id && !p.reversedAt)) {
        throw new Error('Cannot delete a collaboration with active payments');
      }
      next.invoices = next.invoices.filter((i) => i.collaborationId !== input.id);
      next.payments = next.payments.filter((p) => p.collaborationId !== input.id);
      next.testimonials = next.testimonials.filter((t) => t.collaborationId !== input.id);
      next.shares = next.shares.filter((s) => s.targetId !== input.id || s.scope !== 'review');
      next.collaborations = next.collaborations.filter((c) => c.id !== input.id);
      targetId = input.id;
      break;
    }
    case 'collaboration.payment-plan': {
      const collaboration = find(next.collaborations, input.id, 'Collaboration');
      if (issuedFor(collaboration, next.invoices).length) throw new Error('Use the issued invoice balance instead of direct tracking');
      collaboration.expectedPayment = pendingSchema.parse(directReceived(collaboration, next.payments) + input.pending);
      targetId = input.id;
      break;
    }
    case 'invoice.create': {
      unique(next.invoices, input.data.id);
      find(next.brands, input.data.brandId, 'Brand');
      const collaboration = find(next.collaborations, input.data.collaborationId, 'Collaboration');
      if (collaboration.brandId !== input.data.brandId) throw new Error('Invoice and collaboration brands must match');
      next.invoices.push({ ...input.data, number: '', status: 'draft', createdAt: at });
      targetId = input.data.id;
      break;
    }
    case 'invoice.issue': {
      const invoice = find(next.invoices, input.id, 'Invoice');
      if (invoice.status === 'issued') return next;
      if (invoice.status !== 'draft') throw new Error('Only a draft invoice can be issued');
      const collaboration = find(next.collaborations, invoice.collaborationId, 'Collaboration');
      if (directTracking(collaboration, next.payments)) throw new Error('Cannot issue an invoice for a collaboration using direct payment tracking');
      requiredText(5000).parse(invoice.issuer);
      requiredText(5000).parse(invoice.billTo);
      const prefix = `HP-${day.slice(0, 4)}-`;
      let sequence = 1;
      while (next.invoices.some((item) => item.number === `${prefix}${String(sequence).padStart(4, '0')}`)) sequence += 1;
      invoice.number = `${prefix}${String(sequence).padStart(4, '0')}`;
      invoice.status = 'issued';
      targetId = input.id;
      break;
    }
    case 'invoice.void': {
      const invoice = find(next.invoices, input.id, 'Invoice');
      if (invoice.status === 'void') return next;
      if (paid(invoice, next.payments) > 0) throw new Error('Reverse all receipts before voiding an invoice');
      invoice.status = 'void';
      targetId = input.id;
      break;
    }
    case 'payment.create': {
      const existing = next.payments.find((payment) => payment.id === input.data.id);
      if (existing) {
        const same = existing.invoiceId === input.data.invoiceId && existing.collaborationId === input.data.collaborationId && existing.amount === input.data.amount
          && existing.date === input.data.date && existing.method === input.data.method && existing.reference === input.data.reference;
        if (!same) throw new Error('Payment ID was already used with a different payload');
        // Replays remain no-ops even after reversal or invoice void; never resurrect money.
        return next;
      }
      if (input.data.date > day) throw new Error('Receipt date cannot be in the future');
      let remaining: number | null;
      if (input.data.invoiceId) {
        const invoice = find(next.invoices, input.data.invoiceId, 'Invoice');
        if (invoice.status !== 'issued') throw new Error('Receipts require an issued invoice');
        remaining = total(invoice) - paid(invoice, next.payments);
      } else {
        const collaboration = find(next.collaborations, input.data.collaborationId!, 'Collaboration');
        if (issuedFor(collaboration, next.invoices).length) throw new Error('Record this receipt against its issued invoice, not direct tracking');
        remaining = balance(collaboration, next.invoices, next.payments).pending;
      }
      if (remaining !== null && input.data.amount > remaining) throw new Error('Receipt exceeds the outstanding balance');
      next.payments.push({ ...input.data, createdAt: at });
      targetId = input.data.id;
      break;
    }
    case 'payment.reverse': {
      const payment = find(next.payments, input.id, 'Payment');
      if (payment.reversedAt) return next;
      payment.reversedAt = at;
      targetId = input.id;
      break;
    }
    case 'proposal.create':
      unique(next.proposals, input.data.id);
      find(next.brands, input.data.brandId, 'Brand');
      next.proposals.push({ ...input.data, version: 1, status: 'draft', comments: [], createdAt: at });
      targetId = input.data.id;
      break;
    case 'proposal.comment': {
      const proposal = find(next.proposals, input.id, 'Proposal');
      if (proposal.status !== 'sent' || proposal.validUntil < day) throw new Error('Proposal must be sent and unexpired');
      unique(proposal.comments, input.data.id);
      proposal.comments.push({ ...input.data, createdAt: at });
      targetId = input.id;
      break;
    }
    case 'proposal.accept': {
      const proposal = find(next.proposals, input.id, 'Proposal');
      if (proposal.status !== 'sent' || proposal.validUntil < day) throw new Error('Proposal must be sent and unexpired');
      if (proposal.version !== input.version) throw new Error('Proposal version is stale');
      proposal.status = 'accepted';
      proposal.acceptedBy = input.name;
      proposal.acceptedAt = at;
      targetId = input.id;
      break;
    }
    case 'share.create': {
      unique(next.shares, input.data.id);
      if (next.shares.some((share) => share.tokenHash === input.data.tokenHash)) throw new Error('Share hash was already used');
      if (Date.parse(input.data.expiresAt) <= Date.parse(at)) throw new Error('Share must expire in the future');
      if (input.data.scope === 'proposal') {
        const proposal = find(next.proposals, input.data.targetId, 'Proposal');
        if (proposal.validUntil < day) throw new Error('Cannot share an expired proposal');
        if (proposal.status === 'draft') proposal.status = 'sent';
      } else {
        find(next.collaborations, input.data.targetId, 'Collaboration');
      }
      for (const share of next.shares) {
        if (share.scope === input.data.scope && share.targetId === input.data.targetId && !share.revokedAt) share.revokedAt = at;
      }
      next.shares.push({ ...input.data, createdAt: at });
      targetId = input.data.id;
      break;
    }
    case 'share.revoke': {
      const share = find(next.shares, input.id, 'Share');
      if (share.revokedAt) return next;
      share.revokedAt = at;
      targetId = input.id;
      break;
    }
    case 'testimonial.create':
      unique(next.testimonials, input.data.id);
      find(next.collaborations, input.data.collaborationId, 'Collaboration');
      next.testimonials.push({ ...input.data, approved: false, createdAt: at });
      targetId = input.data.id;
      break;
    case 'testimonial.approve': {
      const testimonial = find(next.testimonials, input.id, 'Testimonial');
      if (input.approved && !testimonial.consent) throw new Error('Publication requires explicit consent');
      testimonial.approved = input.approved;
      targetId = input.id;
      break;
    }
    case 'profile.update':
      next.profile = input.data;
      targetId = 'profile';
      break;
    default: {
      const unreachable: never = input;
      throw new Error(`Unsupported command: ${String(unreachable)}`);
    }
  }
  next.revision = z.number().int().nonnegative().parse(next.revision + 1);
  let auditId = `audit-${next.revision}`;
  while (next.audit.some((entry) => entry.id === auditId)) auditId += '-next';
  next.audit.push({ id: auditId, action: input.type, actor: by, targetId, at });
  return next;
}

export function dashboard(state: StudioState, now?: string): Dashboard {
  const data = stateSchema.parse(state);
  validateRelationships(data);
  const day = businessDate(timestamp(now));
  const issued = data.invoices.filter((invoice) => invoice.status === 'issued');
  const issuedIds = new Set(issued.map((invoice) => invoice.id));
  const receipts = data.payments.filter((payment) => (!payment.invoiceId || issuedIds.has(payment.invoiceId)) && !payment.reversedAt);
  const [year, month] = day.split('-').map(Number);
  const monthly = Array.from({ length: 6 }, (_, index) => {
    const key = new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7);
    return { month: key, amount: safeSum(receipts.filter((payment) => payment.date.startsWith(`${key}-`)).map((payment) => payment.amount)) };
  });
  return {
    received: safeSum(receipts.map((payment) => payment.amount)),
    invoiced: safeSum(issued.map(total)),
    outstanding: safeSum(data.collaborations.map((collaboration) => balance(collaboration, data.invoices, receipts).pending ?? 0)),
    overdue: safeSum(issued.filter((invoice) => invoice.dueDate < day).map((invoice) => total(invoice) - paid(invoice, receipts))),
    thisMonth: monthly[5].amount,
    activeCollaborations: data.collaborations.filter((collaboration) => collaboration.stage !== 'posted').length,
    yetToVisit: data.collaborations.filter((collaboration) => collaboration.stage === 'yet_to_visit').length,
    yetToPost: data.collaborations.filter((collaboration) => collaboration.stage === 'yet_to_post').length,
    monthly,
  };
}

/** Explicit allowlists intentionally ignore future/private fields, even on nested objects. */
export function publicPortfolio(state: StudioState): PublicPortfolio {
  const profile = profileSchema.omit({ issuerDetails: true, paymentDetails: true }).parse({
    name: state.profile.name, tagline: state.profile.tagline, bio: state.profile.bio,
    email: state.profile.email, instagram: state.profile.instagram, location: state.profile.location,
  });
  const collaborations: PublicPortfolio['collaborations'] = [];
  for (const item of state.collaborations) {
    const brand = state.brands.find((brand) => brand.id === item.brandId);
    if (!item.published || !brand) continue;
    collaborations.push({
      ...publicCollaborationSchema.parse({
        id: item.id, brandId: item.brandId, title: item.title, category: item.category,
        stage: item.stage, dueDate: item.dueDate, image: item.image, reelUrl: item.reelUrl,
        description: item.description, published: item.published, createdAt: item.createdAt,
      }),
      brandName: requiredText(200).parse(brand.name),
    });
  }
  const testimonials: PublicPortfolio['testimonials'] = [];
  for (const item of state.testimonials) {
    const collaboration = collaborations.find((collaboration) => collaboration.id === item.collaborationId);
    if (!item.consent || !item.approved || !collaboration) continue;
    testimonials.push({
      ...testimonialSchema.parse({
        id: item.id, collaborationId: item.collaborationId, name: item.name, role: item.role,
        text: item.text, consent: item.consent, approved: item.approved, createdAt: item.createdAt,
      }),
      brandName: collaboration.brandName,
    });
  }
  return { profile, collaborations, testimonials };
}

/** Format integer paise without floating-point division, including large aggregate totals. */
export function formatMoney(paise: number): string {
  const value = BigInt(z.number().int().parse(paise));
  const absolute = value < 0n ? -value : value;
  const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(absolute / 100n);
  return `${value < 0n ? '-' : ''}${rupees.replace(/\.00$/, `.${String(absolute % 100n).padStart(2, '0')}`)}`;
}