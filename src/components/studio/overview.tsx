'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, CircleDashed, Clock3, Flower2, Plus, Wallet } from 'lucide-react';
import { dashboard, formatMoney, todayISO } from '@/lib/domain';
import { stageLabels, type Dashboard } from '@/lib/types';
import { Badge, EmptyState, prettyDate } from '@/components/ui/studio-primitives';
import { useStudio } from './store';
import { UpcomingShoots } from './calendar';

export function WorkImage({ src, title, small = false }: { src: string; title: string; small?: boolean }) {
  return <div className={small ? 'studio-work-thumb' : 'studio-work-image'}>{src ? <Image src={src} alt={title} fill unoptimized sizes={small ? '56px' : '(max-width: 700px) 100vw, 380px'} /> : <div className="studio-image-placeholder"><Flower2 size={small ? 24 : 48} strokeWidth={1} aria-hidden="true" /><span>{small ? '' : 'No cover image'}</span></div>}</div>;
}

export function RevenueChart({ monthly }: { monthly: Dashboard['monthly'] }) {
  const max = Math.max(...monthly.map((item) => item.amount), 100);
  const points = monthly.map((item, index) => ({ x: 55 + index * 100, y: 180 - item.amount / max * 132, ...item }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const area = `${line} L555,180 L55,180 Z`;
  return <div className="studio-chart"><svg viewBox="0 0 610 222" role="img" aria-labelledby="studio-revenue-title studio-revenue-desc"><title id="studio-revenue-title">Money received over the last six months</title><desc id="studio-revenue-desc">{monthly.map((item) => `${prettyDate(`${item.month}-01`, { month: 'long', year: 'numeric' })}: ${formatMoney(item.amount)}`).join('. ')}. Reversed receipts are excluded.</desc><defs><linearGradient id="studio-revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity="0.26" /><stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" /></linearGradient></defs>{[0, 1, 2, 3].map((index) => <g key={index}><line x1="55" y1={48 + index * 44} x2="565" y2={48 + index * 44} stroke="var(--border)" strokeDasharray="3 5" /><text x="43" y={52 + index * 44} textAnchor="end" className="studio-chart-axis">{new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.round(max * (3 - index) / 3 / 100))}</text></g>)}<path d={area} fill="url(#studio-revenue-fill)" /><path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round" />{points.map((point) => <g key={point.month}><circle cx={point.x} cy={point.y} r="4.5" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2" /><text x={point.x} y="209" textAnchor="middle" className="studio-chart-axis">{prettyDate(`${point.month}-01`, { month: 'short', day: undefined })}</text></g>)}</svg><details className="studio-chart-data"><summary>View monthly amounts</summary><ul>{monthly.map((item) => <li key={item.month}><span>{prettyDate(`${item.month}-01`, { month: 'long', year: 'numeric', day: undefined })}</span><strong>{formatMoney(item.amount)}</strong></li>)}</ul></details></div>;
}

export function OverviewPage() {
  const { state, demo } = useStudio();
  const metrics = dashboard(state);
  const due = state.collaborations.filter((item) => item.stage !== 'posted' && item.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4);
  const recent = [...state.collaborations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const today = todayISO();
  const stats = [
    { label: 'Money received', value: formatMoney(metrics.received), note: 'All recorded payments, less reversals', icon: ArrowDownLeft, tone: 'sage' },
    { label: 'Pending payments', value: formatMoney(metrics.outstanding), note: 'Known remaining balances only', icon: Wallet, tone: 'blush' },
    { label: 'Yet to visit', value: metrics.yetToVisit, note: 'Collaborations waiting for a visit', icon: CalendarDays, tone: 'sand' },
    { label: 'Yet to post', value: metrics.yetToPost, note: 'Collaborations ready to post', icon: Clock3, tone: 'rose' },
  ];
  return <>
    <section className="studio-welcome"><div><span className="studio-overview-pill"><span /> YOUR STUDIO</span><h1>Home</h1><p>Welcome back, {state.profile.name.split(' ')[0]}. Here’s your work and payment summary.</p><div className="studio-welcome-date"><CalendarDays size={16} aria-hidden="true" />{prettyDate(today, { weekday: 'long', year: 'numeric' })}</div></div><Flower2 className="studio-welcome-flower" size={106} strokeWidth={0.7} aria-hidden="true" /></section>
    <nav className="studio-quick-actions" aria-label="Quick actions"><Link className="studio-button" href="/studio/collaborations?new=1"><Plus size={18} aria-hidden="true" /> Add collaboration</Link><Link className="studio-button studio-button-secondary" href="/studio/calendar"><CalendarDays size={18} aria-hidden="true" /> Plan shoot</Link><Link className="studio-button studio-button-secondary" href="/studio/payments"><Wallet size={18} aria-hidden="true" /> Record payment</Link></nav>
    <section className="studio-stats" aria-label="Studio overview">{stats.map(({ label, value, note, icon: Icon, tone }) => <article key={label} className="studio-stat"><div className="studio-stat-top"><span>{label}</span><span className={`studio-stat-icon studio-bg-${tone}`}><Icon size={19} strokeWidth={1.5} /></span></div><strong>{value}</strong><p>{note}</p></article>)}</section>
    <div className="studio-overview-grid"><section className="studio-card studio-revenue"><div className="studio-card-heading"><div><span className="studio-eyebrow">PAYMENT HISTORY</span><h2>Money received</h2></div><span className="studio-chart-key"><span /> Last 6 months</span></div><div className="studio-revenue-total"><strong>{formatMoney(metrics.thisMonth)}</strong><span>received this month {demo && '· demo'}</span></div><RevenueChart monthly={metrics.monthly} /></section>
      <aside className="studio-up-next"><UpcomingShoots /><section className="studio-card"><div className="studio-card-heading"><h2>Posting deadlines</h2><CalendarDays size={20} strokeWidth={1.4} aria-hidden="true" /></div>{due.length ? <ul className="studio-deadlines">{due.map((item) => <li key={item.id}><div className="studio-date-tile"><strong>{prettyDate(item.dueDate, { day: '2-digit', month: undefined })}</strong><span>{prettyDate(item.dueDate, { month: 'short', day: undefined })}</span></div><Link href="/studio/collaborations"><strong>{item.title}</strong><span>{state.brands.find((brand) => brand.id === item.brandId)?.name} · {stageLabels[item.stage]}</span></Link><ChevronIcon /></li>)}</ul> : <div className="studio-small-empty"><Check size={22} /><p>No posting deadlines set.</p></div>}<Link className="studio-text-link" href="/studio/collaborations">See all collaborations <ArrowRight size={16} /></Link></section></aside>
    </div>
    <section className="studio-card studio-recent"><div className="studio-card-heading"><h2>Recent collaborations <span className="studio-count">{state.collaborations.length}</span></h2><Link className="studio-text-link" href="/studio/collaborations">View all <ArrowRight size={16} /></Link></div>{recent.length ? <div className="studio-table-scroll" role="region" aria-label="Recent collaborations" tabIndex={0}><table className="studio-table"><thead><tr><th>Collaboration</th><th>Category</th><th>Stage</th><th>Posting deadline</th><th><span className="studio-sr-only">Details</span></th></tr></thead><tbody>{recent.map((item) => <tr key={item.id}><td><Link className="studio-table-work" href="/studio/collaborations"><WorkImage src={item.image} title={item.title} small /><span><strong>{item.title}</strong><small>{state.brands.find((brand) => brand.id === item.brandId)?.name}</small></span></Link></td><td>{item.category}</td><td><Badge tone={item.stage === 'posted' ? 'sage' : item.stage.includes('edit') ? 'plum' : 'amber'}>{stageLabels[item.stage]}</Badge></td><td>{item.dueDate ? prettyDate(item.dueDate) : 'Not set'}</td><td><Link className="studio-icon-button" href="/studio/collaborations" aria-label={`View ${item.title}`}><ArrowUpRight size={18} /></Link></td></tr>)}</tbody></table></div> : <EmptyState title="No collaborations yet" description="Add a brand and collaboration to start tracking your work." action={<Link href="/studio/collaborations?new=1" className="studio-button"><Plus size={16} /> Add collaboration</Link>} />}</section>
    <div className="studio-overview-note"><CircleDashed size={17} aria-hidden="true" /><span>{metrics.activeCollaborations} active {metrics.activeCollaborations === 1 ? 'collaboration' : 'collaborations'}</span></div>
  </>;
}

function ChevronIcon() { return <ArrowUpRight size={16} className="studio-muted-icon" aria-hidden="true" />; }