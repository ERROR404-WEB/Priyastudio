export type Stage = 'yet_to_visit' | 'yet_to_record' | 'recorded' | 'yet_to_edit' | 'edited' | 'yet_to_post' | 'posted';
export const stages: Stage[] = ['yet_to_visit', 'yet_to_record', 'recorded', 'yet_to_edit', 'edited', 'yet_to_post', 'posted'];
export const stageLabels: Record<Stage, string> = { yet_to_visit: 'Yet to visit', yet_to_record: 'Yet to record', recorded: 'Recorded', yet_to_edit: 'Yet to edit', edited: 'Edited', yet_to_post: 'Yet to post', posted: 'Posted' };
export interface Brand { id: string; name: string; contact: string; email: string; category: string; notes: string; createdAt: string }
export interface Collaboration { id: string; brandId: string; title: string; category: string; stage: Stage; dueDate: string; image: string; reelUrl: string; description: string; published: boolean; expectedPayment?: number; createdAt: string }
export interface LineItem { description: string; quantity: number; unitPrice: number }
export interface Invoice { id: string; brandId: string; collaborationId: string; number: string; billTo: string; issuer: string; items: LineItem[]; issueDate: string; dueDate: string; notes: string; status: 'draft' | 'issued' | 'void'; createdAt: string }
/** Direct receipts have invoiceId='' and collaborationId; invoice receipts have only invoiceId. */
export interface Payment { id: string; invoiceId: string; collaborationId?: string; amount: number; date: string; method: string; reference: string; reversedAt?: string; createdAt: string }
/** null is an unknown target/balance, not a fully paid collaboration. All money is integer paise. */
export interface CollaborationBalance { source: 'direct' | 'invoice'; received: number; expected: number | null; pending: number | null }
export interface ProposalComment { id: string; name: string; text: string; expectedDate: string; counterOffer: number | null; createdAt: string }
export interface Proposal { id: string; brandId: string; title: string; items: LineItem[]; rights: string; timeline: string; validUntil: string; version: number; status: 'draft' | 'sent' | 'accepted'; comments: ProposalComment[]; acceptedBy?: string; acceptedAt?: string; createdAt: string }
export interface Testimonial { id: string; collaborationId: string; name: string; role: string; text: string; consent: boolean; approved: boolean; createdAt: string }
export interface ShareLink { id: string; targetId: string; scope: 'proposal' | 'review'; tokenHash: string; expiresAt: string; revokedAt?: string; createdAt: string }
export interface Profile { name: string; tagline: string; bio: string; email: string; instagram: string; location: string; issuerDetails: string; paymentDetails: string }
export interface AuditEntry { id: string; action: string; actor: string; targetId: string; at: string }
export interface StudioState { revision: number; profile: Profile; brands: Brand[]; collaborations: Collaboration[]; invoices: Invoice[]; payments: Payment[]; proposals: Proposal[]; testimonials: Testimonial[]; shares: ShareLink[]; audit: AuditEntry[] }
export type Command =
  | { type: 'brand.create'; data: Omit<Brand, 'createdAt'> }
  | { type: 'brand.delete'; id: string }
  | { type: 'collaboration.create'; data: Omit<Collaboration, 'createdAt' | 'published'> }
  | { type: 'collaboration.update'; id: string; data: Partial<Pick<Collaboration, 'stage' | 'dueDate' | 'image' | 'reelUrl' | 'description' | 'published'>> }
  | { type: 'collaboration.delete'; id: string }
  | { type: 'collaboration.payment-plan'; id: string; pending: number }
  | { type: 'invoice.create'; data: Omit<Invoice, 'number' | 'status' | 'createdAt'> }
  | { type: 'invoice.issue'; id: string }
  | { type: 'invoice.void'; id: string }
  | { type: 'payment.create'; data: Omit<Payment, 'createdAt' | 'reversedAt'> }
  | { type: 'payment.reverse'; id: string }
  | { type: 'proposal.create'; data: Omit<Proposal, 'version' | 'status' | 'comments' | 'createdAt' | 'acceptedAt' | 'acceptedBy'> }
  | { type: 'proposal.comment'; id: string; data: Omit<ProposalComment, 'createdAt'> }
  | { type: 'proposal.accept'; id: string; version: number; name: string }
  | { type: 'share.create'; data: Omit<ShareLink, 'createdAt' | 'revokedAt'> }
  | { type: 'share.revoke'; id: string }
  | { type: 'testimonial.create'; data: Omit<Testimonial, 'approved' | 'createdAt'> }
  | { type: 'testimonial.approve'; id: string; approved: boolean }
  | { type: 'profile.update'; data: Profile };
export interface Dashboard { received: number; invoiced: number; outstanding: number; overdue: number; thisMonth: number; activeCollaborations: number; yetToVisit: number; yetToPost: number; monthly: { month: string; amount: number }[] }
/** Explicit allowlist: adding a private Collaboration field must never expand the public contract. */
export type PublicCollaboration = Pick<Collaboration, 'id' | 'brandId' | 'title' | 'category' | 'stage' | 'dueDate' | 'image' | 'reelUrl' | 'description' | 'published' | 'createdAt'> & { brandName: string };
export interface PublicPortfolio { profile: Omit<Profile, 'issuerDetails' | 'paymentDetails'>; collaborations: PublicCollaboration[]; testimonials: (Testimonial & { brandName: string })[] }
export interface ProposalView { proposal: Proposal; brandName: string; creatorName: string }
export interface ReviewView { collaboration: Pick<Collaboration, 'id' | 'title' | 'image' | 'reelUrl'>; brandName: string; creatorName: string }