'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, BookOpen, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronRight, CreditCard, FileText, Flower2, House, Images, LogOut, Menu, Search, Settings2, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { requestJSON } from '@/lib/client';
import { ErrorNotice, prettyDate, useTask } from '@/components/ui/studio-primitives';
import { matchesSearch, useStudio } from './store';

const navigation = [
  { href: '/studio', label: 'Home', icon: House },
  { href: '/studio/collaborations', label: 'Collaborations', icon: BriefcaseBusiness },
  { href: '/studio/calendar', label: 'Shoot calendar', icon: CalendarDays },
  { href: '/studio/payments', label: 'Payments', icon: Wallet },
];
const secondaryNavigation = [
  { href: '/studio/brands', label: 'Brands', icon: BookOpen },
  { href: '/studio/proposals', label: 'Rate cards', icon: FileText },
  { href: '/studio/invoices', label: 'Invoices', icon: CreditCard },
  { href: '/studio/portfolio', label: 'Portfolio', icon: Images },
  { href: '/studio/settings', label: 'Settings', icon: Settings2 },
];

export function StudioLogo() {
  return <div className="studio-logo"><span className="studio-monogram">p<span>.</span><Flower2 aria-hidden="true" size={17} strokeWidth={1.2} /></span><span><strong>Hey Priya</strong><small>CREATOR STUDIO</small></span></div>;
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { demo, state, setSearch } = useStudio();
  const links = (items: typeof navigation) => items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`studio-nav-link${pathname === href ? ' studio-nav-active' : ''}`} aria-current={pathname === href ? 'page' : undefined} onClick={() => { setSearch(''); onNavigate?.(); }}><Icon size={19} strokeWidth={1.6} aria-hidden="true" /><span>{label}</span>{pathname === href && <span className="studio-nav-active-dot" />}</Link>);
  return <>
    <Link href="/studio" className="studio-logo-link" aria-label="Hey Priya studio home" onClick={() => { setSearch(''); onNavigate?.(); }}><StudioLogo /></Link>
    <div className="studio-sidebar-note"><span /> Your private workspace</div>
    <nav className="studio-nav" aria-label="Studio navigation">
      {links(navigation)}
      <details key={pathname} className="studio-nav-more" open={secondaryNavigation.some((item) => item.href === pathname)}>
        <summary><span>More</span><ChevronDown size={18} aria-hidden="true" /></summary>
        <div className="studio-nav-secondary">{links(secondaryNavigation)}</div>
      </details>
    </nav>
    <div className="studio-sidebar-footer"><Link className="studio-public-link" href="/" onClick={onNavigate}>View public portfolio <ArrowUpRight size={17} aria-hidden="true" /></Link>{demo && <span className="studio-demo-badge">LOCAL DEMO · SAMPLE DATA</span>}<div className="studio-admin"><span className="studio-avatar">{state.profile.name.slice(0, 1).toUpperCase()}</span><span><strong>{state.profile.name}</strong><small>Studio admin</small></span><span className="studio-admin-dot" title="Single-admin workspace" /></div></div>
  </>;
}

function GlobalSearch() {
  const { state, search, setSearch } = useStudio();
  const pathname = usePathname();
  const global = pathname === '/studio' || pathname === '/studio/settings';
  const entries = [
    ...state.collaborations.map((item) => ({ key: item.id, title: item.title, detail: 'Collaboration', href: '/studio/collaborations', terms: state.brands.find((brand) => brand.id === item.brandId)?.name })),
    ...state.brands.map((item) => ({ key: item.id, title: item.name, detail: 'Brand', href: '/studio/brands', terms: item.category })),
    ...state.proposals.map((item) => ({ key: item.id, title: item.title, detail: 'Rate card', href: '/studio/proposals', terms: '' })),
    ...state.invoices.map((item) => ({ key: item.id, title: item.number || 'Draft invoice', detail: 'Invoice', href: '/studio/invoices', terms: item.billTo })),
  ].filter((item) => matchesSearch(search, item.title, item.detail, item.terms)).slice(0, 7);
  return <div className="studio-search-wrap"><label className="studio-search"><Search size={18} aria-hidden="true" /><span className="studio-sr-only">{global ? 'Search studio' : 'Search this page'}</span><input type="search" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={global ? 'Search collaborations, brands, invoices…' : 'Search this page…'} />{search && <button type="button" aria-label="Clear search" className="studio-icon-button" onClick={() => setSearch('')}><X size={16} /></button>}</label>
    {global && search.trim() && <div className="studio-search-results" aria-label="Search results"><p className="studio-eyebrow">SEARCH RESULTS</p>{entries.length ? entries.map((item) => <Link key={`${item.detail}-${item.key}`} href={item.href} onClick={() => setSearch(item.title === 'Draft invoice' ? 'draft' : item.title)}><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={16} /></Link>) : <p>No results. Try a brand or collaboration name.</p>}</div>}
  </div>;
}

export function StudioShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { demo, error, clearError, state } = useStudio();
  const [mobileOpen, setMobileOpen] = useState(false);
  const signOut = useTask();
  const current = [...navigation, ...secondaryNavigation].find((item) => item.href === pathname)?.label ?? 'Studio';
  return <div className="studio-app">
    <a className="studio-skip" href="#studio-main">Skip to content</a>
    <aside className="studio-sidebar"><Navigation /></aside>
    <div className="studio-workspace">
      <header className="studio-topbar">
        <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}><Dialog.Trigger className="studio-icon-button studio-mobile-menu" aria-label="Open studio navigation"><Menu size={22} /></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="studio-overlay" /><Dialog.Content className="studio-mobile-sidebar"><Dialog.Title className="studio-sr-only">Studio navigation</Dialog.Title><Dialog.Description className="studio-sr-only">Open a Studio page. More contains additional tools.</Dialog.Description><Dialog.Close className="studio-icon-button studio-mobile-close" aria-label="Close navigation"><X size={20} /></Dialog.Close><Navigation onNavigate={() => setMobileOpen(false)} /></Dialog.Content></Dialog.Portal></Dialog.Root>
        <div className="studio-breadcrumb"><span>Your studio</span><ChevronRight size={14} /><strong>{current}</strong></div>
        <GlobalSearch />
        <span className="studio-topbar-date">{prettyDate(new Date().toISOString(), { weekday: 'short' })}</span>
        <ThemeToggle />
        <Link className="studio-avatar studio-topbar-avatar" href="/studio/settings" aria-label="Open profile settings">{state.profile.name.slice(0, 1).toUpperCase()}</Link>
      </header>
      <main id="studio-main" className="studio-main">
        {demo && <div className="studio-demo-strip"><span className="studio-demo-indicator" aria-hidden="true" /><span><strong>Local demo</strong> · Sample data saved on this computer. No real payments or Google reminders.</span></div>}
        {(error || signOut.error) && <div className="studio-shared-error"><ErrorNotice message={error || signOut.error} /><button type="button" className="studio-icon-button" aria-label="Dismiss error" onClick={() => { clearError(); signOut.setError(null); }}><X size={17} /></button></div>}
        {children}
        <footer className="studio-main-footer"><span><Flower2 size={14} aria-hidden="true" /> Hey Priya · Private creator studio</span>{!demo && <button className="studio-button studio-button-quiet" disabled={signOut.pending} onClick={() => void signOut.run(async () => { await requestJSON('/api/auth/sign-out', { method: 'POST', body: '{}' }); router.replace('/login'); router.refresh(); })}><LogOut size={15} /> {signOut.pending ? 'Signing out…' : 'Sign out'}</button>}</footer>
      </main>
    </div>
  </div>;
}