import { applyCommand, todayISO } from './domain';
import type { Command, StudioState } from './types';

export function createEmptyState(): StudioState {
  return {
    revision: 0,
    profile: {
      name: 'Priya', tagline: 'Little moments. Lovely stories.',
      bio: 'Food, cafés, lifestyle and travel — stories from Hyderabad and beyond.',
      email: 'heyitsvishnupriya@gmail.com', instagram: 'https://www.instagram.com/hey.its_priya_/',
      location: 'Hyderabad', issuerDetails: '', paymentDetails: '',
    },
    brands: [], collaborations: [], invoices: [], payments: [], proposals: [],
    testimonials: [], shares: [], audit: [],
  };
}

/** Synthetic workspace examples, not claims about these brands. Callers MUST show a demo label. */
export function createDemoState(): StudioState {
  const now = new Date().toISOString();
  const today = todayISO();
  const [year, month] = today.split('-').map(Number);
  const monthDate = (offset: number, day = 1) => new Date(Date.UTC(year, month - 1 + offset, day)).toISOString().slice(0, 10);
  let state = createEmptyState();
  const add = (command: Command) => { state = applyCommand(state, command, 'synthetic-demo', now); };
  const brands = [
    ['Nomme', 'Lifestyle'], ['HawTea', 'Cafés'], ['Nord Coffee', 'Cafés'],
    ['Roastery Coffee House', 'Cafés'], ['Theobroma', 'Food'],
    ['Third Wave Coffee', 'Cafés'], ['Starbucks', 'Cafés'],
  ];
  brands.forEach(([name, category], index) => add({
    type: 'brand.create', data: {
      id: `demo-brand-${index + 1}`, name, category, contact: '', email: '',
      notes: 'Synthetic demo relationship and financial examples; not a record of an actual engagement.',
    },
  }));
  const work = [
    ['Everyday little luxuries', 'Lifestyle', '/images/lifestyle.jpg', 'https://www.instagram.com/reel/DYR6geRzS8X/'],
    ['A slower afternoon', 'Cafés', '/images/cafe.jpg', 'https://www.instagram.com/reel/DX9TKFytR2U/'],
    ['Coffee, conversations & corners', 'Cafés', '/images/cafe.jpg', ''],
    ['A weekend in the city', 'Travel', '/images/travel.jpg', ''],
    ['Something sweet is coming', 'Food', '/images/food.jpg', ''],
  ];
  work.forEach(([title, category, image, reelUrl], index) => {
    add({
      type: 'collaboration.create', data: {
        id: `demo-work-${index + 1}`, brandId: `demo-brand-${index + 1}`, title, category,
        stage: index === 4 ? 'yet_to_edit' : 'posted', dueDate: index === 4 ? monthDate(1) : monthDate(index - 5),
        image, reelUrl, description: 'Sample portfolio layout using synthetic campaign details; not a claim of a paid brand engagement.',
      },
    });
    if (index !== 4) add({ type: 'collaboration.update', id: `demo-work-${index + 1}`, data: { published: true } });
  });
  const amounts = [1_800_000, 1_200_000, 1_500_000, 900_000, 800_000];
  const issueDates = [monthDate(-5), monthDate(-2), monthDate(0), monthDate(-1), today];
  const dueDates = [monthDate(-4), monthDate(-1), monthDate(1), monthDate(-1, 20), monthDate(1)];
  amounts.forEach((amount, index) => {
    add({
      type: 'invoice.create', data: {
        id: `demo-invoice-${index + 1}`, brandId: `demo-brand-${index + 1}`, collaborationId: `demo-work-${index + 1}`,
        // Only the supplied creator name is used: no invented address, registration, bank or tax data.
        issuer: 'Priya — synthetic demo only, not for billing', billTo: `${brands[index][0]} — synthetic example only`,
        items: [{ description: 'Synthetic example: content creation', quantity: 1, unitPrice: amount }],
        issueDate: issueDates[index], dueDate: dueDates[index],
        notes: 'SYNTHETIC DEMO — not an actual invoice, payment request or GST tax invoice. Configure real issuer details before billing.',
      },
    });
    if (index !== 4) add({ type: 'invoice.issue', id: `demo-invoice-${index + 1}` });
  });
  // Six months with receipts, including the current month; no future-dated money on month one.
  for (let index = 0; index < 6; index += 1) {
    add({
      type: 'payment.create', data: {
        id: `demo-receipt-${index + 1}`, invoiceId: index < 3 ? 'demo-invoice-1' : index < 5 ? 'demo-invoice-2' : 'demo-invoice-3',
        amount: index === 5 ? 450_000 : 600_000, date: monthDate(index - 5),
        method: 'Synthetic example', reference: `DEMO-NOT-A-REAL-RECEIPT-${index + 1}`,
      },
    });
  }
  ['A new season of stories', 'Your next coffee moment', 'A taste of the weekend'].forEach((title, index) => add({
    type: 'proposal.create', data: {
      id: `demo-proposal-${index + 1}`, brandId: `demo-brand-${index + 1}`, title,
      items: [{ description: 'Synthetic example: one reel and story set', quantity: 1, unitPrice: (index + 1) * 600_000 }],
      rights: 'Example terms: organic social use only; paid usage to be agreed separately.',
      timeline: 'Example schedule; posting date remains subject to creator confirmation.', validUntil: monthDate(1, 15),
    },
  }));
  // Testimonials intentionally remain empty: never attribute fabricated endorsements to real brands.
  return state;
}