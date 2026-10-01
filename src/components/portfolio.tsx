'use client';

import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowRight, ArrowUpRight, Camera, Camera as Instagram, Coffee, Flower2, Mail, MapPin, Menu, Play, Plus, Quote, Search, Sparkles, Star, X } from 'lucide-react';
import { Fragment, useRef, useState, type CSSProperties } from 'react';
import type { PublicCollaboration, PublicPortfolio } from '@/lib/types';
import { PortfolioMotion } from './portfolio-motion';
import { ThemeToggle } from './theme-toggle';

export function Wordmark() {
  return <span className="wordmark">hey, <i>Priya.</i><Flower2 size={18} strokeWidth={1.25} aria-hidden="true" /></span>;
}

function Bow({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 100 70" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M49 31C29 2 7 3 12 22c3 13 25 16 37 9Zm2 0C71 2 93 3 88 22c-3 13-25 16-37 9ZM47 34C42 47 31 48 29 65l12-7 7 5 2-27m3-2c5 13 16 14 18 31l-12-7-7 5-2-27" /><ellipse cx="50" cy="32" rx="4" ry="5" /></svg>;
}

const navigation = [
  { href: '#about', label: 'About me' },
  { href: '#work', label: 'Selected work' },
  { href: '#offerings', label: 'What I create' },
  { href: '#contact', label: 'Collaborate' },
];

const specialties = ['Lifestyle', 'Café discoveries', 'Food stories', 'Little escapes', 'Thoughtful UGC'];
const WORK_PAGE = 20;
const BRAND_PREVIEW = 36;

type BrandGroup = { id: string; name: string; category: string; cover: string; stories: PublicCollaboration[] };
/** One entry per brand, newest story first; preserves the order of the given stories. */
function groupByBrand(stories: readonly PublicCollaboration[]): BrandGroup[] {
  const groups = new Map<string, BrandGroup>();
  for (const story of stories) {
    const group = groups.get(story.brandId) ?? { id: story.brandId, name: story.brandName, category: story.category, cover: '', stories: [] };
    group.stories.push(story);
    group.cover ||= story.image;
    groups.set(story.brandId, group);
  }
  return [...groups.values()];
}
const storyCount = (count: number) => `${count} ${count === 1 ? 'story' : 'stories'}`;

export function Portfolio({ portfolio, demo, unavailable = false }: { portfolio: PublicPortfolio; demo: boolean; unavailable?: boolean }) {
  // Only the server's public allowlist enters this component.
  const { profile, collaborations, testimonials } = portfolio;
  const [category, setCategory] = useState('All stories');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(WORK_PAGE);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [openBrandId, setOpenBrandId] = useState<string | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const categories = ['All stories', ...new Set(collaborations.map((item) => item.category))];
  const needle = query.trim().toLowerCase();
  const newestFirst = [...collaborations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const allGroups = groupByBrand(newestFirst);
  const groups = groupByBrand(newestFirst.filter((item) => (category === 'All stories' || item.category === category) && (!needle || `${item.brandName} ${item.title}`.toLowerCase().includes(needle))));
  const shown = groups.slice(0, visible);
  const openBrand = allGroups.find((group) => group.id === openBrandId);
  const brands = [...allGroups].sort((a, b) => a.name.localeCompare(b.name));
  const shownBrands = brandsOpen ? brands : brands.slice(0, BRAND_PREVIEW);
  const chooseCategory = (value: string) => { setCategory(value); setVisible(WORK_PAGE); };
  const search = (value: string) => { setQuery(value); setVisible(WORK_PAGE); };
  const closeMenu = () => { if (menu.current) menu.current.open = false; };

  return <PortfolioMotion>
    <a className="skip-link" href="#main">Skip to content</a>
    {demo && <div className="portfolio-demo"><span>A preview of Hey Priya Studio · sample collaboration details</span><Link href="/studio">Explore the studio <ArrowUpRight size={13} aria-hidden="true" /></Link></div>}
    <header className="portfolio-header">
      <Link href="/" aria-label="Hey Priya home"><Wordmark /></Link>
      <nav className="portfolio-nav" aria-label="Main navigation">{navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}</nav>
      <div className="portfolio-header-actions">
        <ThemeToggle />
        <a className="button nav-cta" href={`mailto:${profile.email}`}>Let’s create <ArrowUpRight size={16} aria-hidden="true" /></a>
        <details className="portfolio-menu" ref={menu} onKeyDown={(event) => {
          if (event.key === 'Escape') { closeMenu(); menu.current?.querySelector('summary')?.focus(); }
        }}>
          <summary aria-label="Menu"><Menu size={22} aria-hidden="true" /></summary>
          <nav aria-label="Mobile navigation">{navigation.map((item) => <a key={item.href} href={item.href} onClick={closeMenu}>{item.label}<ArrowUpRight size={17} aria-hidden="true" /></a>)}</nav>
        </details>
      </div>
    </header>
    <main id="main">
      <section className="portfolio-hero" id="about" aria-labelledby="portfolio-title">
        <div className="hero-copy">
          <span className="eyebrow"><span className="live-dot" /> CONTENT CREATOR · {profile.location.toUpperCase()}</span>
          <div className="hero-kicker"><span>A visual diary by {profile.name}</span><Star size={17} strokeWidth={1.2} aria-hidden="true" /></div>
          <h1 id="portfolio-title">Everyday moments.<br /><i>A little <span>magic.<svg viewBox="0 0 300 16" aria-hidden="true"><path d="M3 11Q130 0 296 7M30 15Q173 5 276 12" /></svg></span></i><span className="hero-name">Hey, I’m {profile.name}.</span></h1>
          <p>{profile.bio}</p>
          <div className="hero-actions"><a className="button" href="#work">Explore my work <ArrowDown size={17} aria-hidden="true" /></a><a className="text-link" href="#contact">Let’s tell your story <ArrowUpRight size={17} aria-hidden="true" /></a></div>
          <div className="hero-signoff"><Bow /><span>Made to feel.<br /><i>Not just to scroll past.</i></span></div>
        </div>
        <div className="hero-scroll-track"><div className="hero-visual" aria-label="A scrapbook of Priya’s photography">
          <div className="hero-orbit" aria-hidden="true" />
          <span className="photo-note" data-depth=".4">little moments, lovely stories <Sparkles size={19} strokeWidth={1} aria-hidden="true" /></span>
          <figure className="hero-photo" data-depth=".75"><span className="photo-tape" aria-hidden="true" /><img src="/images/priya.jpg" alt="Priya, lifestyle and food creator from Hyderabad" width={600} height={800} fetchPriority="high" /><figcaption>the girl behind the stories <span>01 /</span></figcaption></figure>
          <figure className="detail-photo" data-depth="1.4"><span className="photo-tape" aria-hidden="true" /><img src="/images/priya-detail.jpg" alt="Priya smiling in a pink saree, holding a bouquet of orchids" width={280} height={330} /></figure>
          <div className="hero-stamp" data-depth="1.1" aria-hidden="true"><Flower2 size={35} strokeWidth={1} /><span>a little soul<br /><i>in every story</i></span></div>
          <Bow className="hero-bow" /><Star className="hero-star" size={30} strokeWidth={1} aria-hidden="true" />
          {[1, 2, 3].map((n) => <Sparkles key={n} className={`hero-sparkle sparkle-${n}`} size={n === 2 ? 22 : 16} strokeWidth={1} aria-hidden="true" />)}
          <span className="photo-location"><MapPin size={13} aria-hidden="true" /> {profile.location} & beyond</span>
          <span className="scrapbook-index" aria-hidden="true">THE EVERYDAY EDIT — VOL. 01</span>
          <div className="scene-scroll-cue" aria-hidden="true"><span>Scroll to unfold</span><span className="scene-progress"><span /></span><ArrowDown size={15} /></div>
        </div></div>
      </section>
      <div className="niche-ribbon" aria-label="Creative specialties"><div className="niche-track">{[0, 1, 2, 3].map((copy) => <div className="niche-set" key={copy} aria-hidden={copy > 0 || undefined}>{specialties.map((item) => <Fragment key={item}><span>{item}</span><Flower2 size={20} aria-hidden="true" /></Fragment>)}</div>)}</div></div>
      <section className="intro-section" id="offerings" aria-labelledby="offerings-title">
        <div className="intro-heading" data-reveal><span className="eyebrow">A PRETTY FRAME. A REAL CONNECTION.</span><h2 id="offerings-title">Your brand, but make it<br /><i>feel like a favourite.</i></h2><p>{profile.tagline || 'Thoughtful stories for brands with something lovely to share.'}</p></div>
        <div className="intro-services">
          <article data-reveal><span className="service-number">01 /</span><Camera size={26} strokeWidth={1.2} aria-hidden="true" /><h3>Stories in motion</h3><p>Reels & visual storytelling that turn the everyday into something worth watching.</p><span className="service-label">REELS · LIFESTYLE · FOOD</span></article>
          <article data-reveal><span className="service-number">02 /</span><Coffee size={26} strokeWidth={1.2} aria-hidden="true" /><h3>Places with personality</h3><p>Cafés, stays & little escapes, captured through the details that make them yours.</p><span className="service-label">EXPERIENCES · DISCOVERIES</span></article>
          <article data-reveal><span className="service-number">03 /</span><Sparkles size={26} strokeWidth={1.2} aria-hidden="true" /><h3>Content that connects</h3><p>Thoughtful UGC & brand photography with a natural, lived-in point of view.</p><span className="service-label">UGC · BRAND CONTENT</span></article>
        </div>
      </section>
      <section className="work-section" id="work" aria-labelledby="work-title">
        <div className="section-heading" data-reveal><div><span className="eyebrow">THE CREATIVE DIARY</span><h2 id="work-title">A few stories <i>I’ve told.</i></h2></div><p>A collection of places, moments and brands, through my lens.</p></div>
        <div className="work-toolbar">
          <div className="category-tabs" role="group" aria-label="Filter selected work">{categories.map((item) => <button type="button" key={item} onClick={() => chooseCategory(item)} aria-pressed={item === category} className={item === category ? 'selected' : ''}>{item}</button>)}</div>
          <label className="work-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => search(event.target.value)} placeholder="Search a brand or story" aria-label="Search brands or stories" maxLength={80} /></label>
        </div>
        <p className="portfolio-result-count" role="status">{shown.length < groups.length ? `Showing ${shown.length} of ${groups.length}` : groups.length} {groups.length === 1 ? 'brand' : 'brands'} · {category}{needle ? ` · “${query.trim()}”` : ''}</p>
        {shown.length ? <div className="portfolio-grid">{shown.map((group, index) => <article key={group.id} className={`portfolio-work work-${index % 3}`} data-reveal>
          {/* The heading button is the accessible control; the frame is a larger pointer target for it. */}
          <div className="portfolio-work-photo" aria-hidden="true" onClick={() => setOpenBrandId(group.id)}>{group.cover ? <img src={group.cover} alt="" width={600} height={700} loading="lazy" /> : <span className={`work-monogram tint-${index % 4}`}><Flower2 size={18} strokeWidth={1.2} /><strong>{group.name}</strong></span>}<span className="work-category">{group.category}</span><span className="work-play"><Play size={13} fill="currentColor" />{group.stories.length > 1 && <b>{group.stories.length}</b>}</span></div>
          <div className="portfolio-work-caption"><div><span>{storyCount(group.stories.length)}</span><h3><button type="button" aria-haspopup="dialog" onClick={() => setOpenBrandId(group.id)}>{group.name}</button></h3></div><span className="portfolio-work-arrow" aria-hidden="true"><ArrowUpRight size={16} strokeWidth={1.3} /></span></div>
        </article>)}</div> : collaborations.length ? <div className="public-empty"><Search size={36} strokeWidth={1} aria-hidden="true" /><h3>No stories match that, yet.</h3><p>Try another brand name, or browse every story.</p><button type="button" className="text-link work-reset" onClick={() => { chooseCategory('All stories'); search(''); }}>Show all stories <ArrowRight size={16} aria-hidden="true" /></button></div> : <div className="public-empty"><Flower2 size={40} strokeWidth={1} aria-hidden="true" /><h3>Fresh stories are on their way.</h3><p>{unavailable ? 'Selected work is temporarily unavailable. You can still find the latest on Instagram.' : 'Until then, find my latest work and everyday discoveries on Instagram.'}</p><a className="text-link" href={profile.instagram} target="_blank" rel="noreferrer">Visit Instagram <ArrowUpRight size={16} aria-hidden="true" /></a></div>}
        {shown.length < groups.length && <div className="work-more">
          <span className="work-more-meter" style={{ '--shown': shown.length / groups.length } as CSSProperties} aria-hidden="true"><span /></span>
          <button type="button" className="button button-secondary" onClick={() => setVisible((count) => count + WORK_PAGE)}><Plus size={16} aria-hidden="true" /> Show {Math.min(WORK_PAGE, groups.length - shown.length)} more brands</button>
        </div>}
        <a className="work-instagram text-link" href={profile.instagram} target="_blank" rel="noreferrer"><Instagram size={17} aria-hidden="true" /> More everyday stories on Instagram <ArrowUpRight size={16} aria-hidden="true" /></a>
      </section>
      {brands.length > 0 && <section className="brand-section" id="brands" aria-labelledby="brands-title">
        <div className="section-heading" data-reveal><div><span className="eyebrow">THE BRAND BOOK</span><h2 id="brands-title">{brands.length} {brands.length === 1 ? 'brand' : 'brands'} <i>& counting.</i></h2></div><p>Every name here trusted me with their story.<br />Pick one to see what we made together.</p></div>
        <ul className="brand-wall">{shownBrands.map((brand) => <li key={brand.id}><button type="button" aria-haspopup="dialog" onClick={() => setOpenBrandId(brand.id)}>{brand.name}<sup aria-hidden="true">{brand.stories.length}</sup><span className="sr-only">, {storyCount(brand.stories.length)}</span></button></li>)}</ul>
        {brands.length > BRAND_PREVIEW && <button type="button" className="text-link brand-toggle" aria-expanded={brandsOpen} onClick={() => setBrandsOpen((open) => !open)}>{brandsOpen ? 'Show fewer brands' : `See all ${brands.length} brands`} <ArrowDown size={15} aria-hidden="true" /></button>}
      </section>}
      <section className="love-section" id="love" aria-labelledby="love-title"><Bow className="love-bow" /><span className="eyebrow">LITTLE NOTES, BIG MEANING</span><h2 id="love-title" data-reveal>Good work. <i>Kind words.</i></h2>{testimonials.length ? <div className="testimonial-grid">{testimonials.map((review) => <blockquote key={review.id} data-reveal><Quote size={25} strokeWidth={1} aria-hidden="true" /><p>“{review.text}”</p><footer><strong>{review.name}</strong><span>{review.role ? `${review.role} · ` : ''}{review.brandName}</span></footer></blockquote>)}</div> : <div className="love-empty"><p>The best collaborations start with a connection.</p><span>Brand notes appear here only with permission. Yours could be the next chapter.</span><a className="text-link" href="#contact">Start a conversation <ArrowUpRight size={16} aria-hidden="true" /></a></div>}</section>
      <section className="contact-section" id="contact" aria-labelledby="contact-title"><div className="contact-flower" aria-hidden="true"><Flower2 size={150} strokeWidth={.6} /></div><span className="eyebrow">YOUR BRAND. MY LENS. SOMETHING LOVELY.</span><h2 id="contact-title" data-reveal>Let’s make a little<br /><i>magic together.</i></h2><p>Have a launch, a lovely place, or a story in mind?<br />Tell me a little about your brand. We’ll take it from there.</p><a className="button" href={`mailto:${profile.email}`}><Mail size={17} aria-hidden="true" /> Let’s talk collaborations <ArrowUpRight size={17} aria-hidden="true" /></a><a className="contact-email" href={`mailto:${profile.email}`}>{profile.email}</a><span className="contact-note">good things start with a hello.</span></section>
    </main>
    <footer className="portfolio-footer"><Link href="/" aria-label="Back to Hey Priya home"><Wordmark /></Link><span>Thoughtfully created in {profile.location}. © {new Date().getFullYear()}</span><a className="text-link" href={profile.instagram} target="_blank" rel="noreferrer">See you on Instagram <ArrowRight size={15} aria-hidden="true" /></a></footer>
    <Dialog.Root open={!!openBrand} onOpenChange={(open) => { if (!open) setOpenBrandId(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="brand-dialog-overlay" />
        {openBrand && <Dialog.Content className="brand-dialog" data-lenis-prevent aria-describedby={undefined}>
          <header className="brand-dialog-header">
            <span className="eyebrow">{openBrand.category.toUpperCase()} · {storyCount(openBrand.stories.length).toUpperCase()}</span>
            <Dialog.Title>{openBrand.name}</Dialog.Title>
            <Dialog.Close className="brand-dialog-close" aria-label="Close"><X size={20} aria-hidden="true" /></Dialog.Close>
          </header>
          <ul className="brand-reels">{openBrand.stories.map((story, index) => <li key={story.id}>
            {story.image ? <img src={story.image} alt="" width={160} height={200} loading="lazy" /> : <span className={`work-monogram tint-${index % 4}`} aria-hidden="true"><Flower2 size={16} strokeWidth={1.2} /></span>}
            <div><h3>{story.title}</h3><span>{story.category}</span></div>
            {story.reelUrl ? <a className="button" href={story.reelUrl} target="_blank" rel="noreferrer">Watch <span className="sr-only">{story.title} on Instagram</span><ArrowUpRight size={15} aria-hidden="true" /></a> : <span className="brand-reel-soon">Reel coming soon</span>}
          </li>)}</ul>
        </Dialog.Content>}
      </Dialog.Portal>
    </Dialog.Root>
  </PortfolioMotion>;
}