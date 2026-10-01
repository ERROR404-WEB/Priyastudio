'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Lenis from 'lenis';
import { Flower2 } from 'lucide-react';

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
const unit = (value: number) => Math.max(0, Math.min(1, value));
const layerProperties = ['--motion-x', '--motion-y', '--motion-z', '--motion-rx', '--motion-ry', '--motion-rz'];
const workProperties = ['--work-progress', '--work-y', '--work-rx', '--image-y', '--pointer-rx', '--pointer-ry'];

/** One event-driven frame for the entire scene. No animation loop or React pointer state. */
export function PortfolioMotion({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)');
    const compact = matchMedia('(max-width: 899px)');
    let dispose = () => {};

    function configure() {
      dispose();
      if (!root) return;
      root.dataset.motion = 'static';
      // Scroll animation is independent of hover, pointer type and screen width.
      if (reduced.matches) return;
      root.dataset.motion = 'ready';
      const track = root.querySelector<HTMLElement>('.hero-scroll-track');
      const scene = root.querySelector<HTMLElement>('.hero-visual');
      const layers = Array.from(root.querySelectorAll<HTMLElement>('[data-depth]'));
      const follower = root.querySelector<HTMLElement>('.portfolio-follower');
      // Inertial wheel scrolling only; touch and keyboard stay native.
      const lenis = new Lenis({ lerp: .085, smoothWheel: true, autoRaf: true });
      // Dialogs lock scrolling via this body attribute; inertia must not move the page behind them.
      const scrollLock = new MutationObserver(() => { if (document.body.hasAttribute('data-scroll-locked')) lenis.stop(); else lenis.start(); });
      scrollLock.observe(document.body, { attributes: true, attributeFilter: ['data-scroll-locked'] });
      let works: { article: HTMLElement; photo: HTMLElement }[] = [];
      let frame = 0;
      let disposed = false;
      let x = 0;
      let y = 0;
      let inside = false;
      let activeCard: HTMLElement | null = null;
      let lastCard: HTMLElement | null = null;
      let activeMagnet: HTMLElement | null = null;
      let lastMagnet: HTMLElement | null = null;
      const revealed = new Set<Element>();

      function paint() {
        frame = 0;
        if (disposed || document.hidden || reduced.matches || !root) return;
        // Batch layout reads before style writes. Scene itself never transforms.
        const trackRect = track?.getBoundingClientRect();
        const rect = scene?.getBoundingClientRect();
        const stickyTop = scene ? parseFloat(getComputedStyle(scene).top) || 0 : 0;
        const range = track && scene ? Math.max(1, track.offsetHeight - scene.offsetHeight) : 1;
        const progress = trackRect ? unit((stickyTop - trackRect.top) / range) : 0;
        const unfolded = progress * progress * (3 - 2 * progress);
        const workRects = works.map((work) => ({ ...work, rect: work.article.getBoundingClientRect() }));
        const cardRect = workRects.find((work) => work.photo === activeCard)?.rect;
        const magnetRect = activeMagnet?.getBoundingClientRect();
        const scrollable = document.documentElement.scrollHeight - innerHeight;
        root.style.setProperty('--page-progress', scrollable > 0 ? unit(scrollY / scrollable).toFixed(4) : '0');
        const px = rect && inside ? clamp((x - rect.left - rect.width / 2) / (rect.width / 2), 1) : 0;
        const py = rect && inside ? clamp((y - rect.top - rect.height / 2) / (rect.height / 2), 1) : 0;
        const small = compact.matches;
        if (track) {
          track.dataset.scrollProgress = progress.toFixed(4);
          track.style.setProperty('--scene-progress', String(progress));
        }
        if (rect && rect.bottom > -200 && rect.top < innerHeight + 200) {
          for (const layer of layers) {
            const depth = Number(layer.dataset.depth);
            const main = layer.classList.contains('hero-photo');
            const detail = layer.classList.contains('detail-photo');
            const dx = main ? (small ? 5 - unfolded * 15 : 10 - unfolded * 35) : detail ? (small ? -2 + unfolded * 3 : 8 + unfolded * 7) : -unfolded * 10;
            const dy = main ? (.4 - unfolded) * (small ? 90 : 180) : detail ? (small ? 35 - unfolded * 95 : 60 - unfolded * 150) : -unfolded * 35 * depth;
            const z = main ? (small ? -15 + unfolded * 45 : -65 + unfolded * 180) : detail ? (small ? 5 + unfolded * 35 : 30 + unfolded * 70) : 0;
            layer.style.setProperty('--motion-x', `${dx + px * depth * 7}px`);
            layer.style.setProperty('--motion-y', `${dy + py * depth * 5}px`);
            layer.style.setProperty('--motion-z', `${z}px`);
            layer.style.setProperty('--motion-rx', `${(main ? 12 - unfolded * 23 : -8 + unfolded * 16) - py * depth * 3}deg`);
            layer.style.setProperty('--motion-ry', `${(main ? -12 + unfolded * 23 : 14 - unfolded * 26) + px * depth * 4}deg`);
            layer.style.setProperty('--motion-rz', `${main ? -5 + unfolded * 10 : 6 - unfolded * 16}deg`);
          }
        }
        for (const { photo, rect: workRect } of workRects) {
          if (workRect.bottom < -200 || workRect.top > innerHeight + 200) continue;
          const p = unit((innerHeight - workRect.top) / (innerHeight + workRect.height));
          const entrance = 1 - unit((innerHeight * .95 - workRect.top) / (innerHeight * .8));
          photo.style.setProperty('--work-progress', p.toFixed(4));
          photo.style.setProperty('--work-y', `${entrance * (small ? 28 : 44)}px`);
          photo.style.setProperty('--work-rx', `${entrance * (small ? 8 : 12)}deg`);
          photo.style.setProperty('--image-y', `${(.5 - p) * 14}%`);
        }
        if (lastCard !== activeCard) {
          lastCard?.style.removeProperty('--pointer-rx');
          lastCard?.style.removeProperty('--pointer-ry');
        }
        if (activeCard && cardRect) {
          const cx = clamp((x - cardRect.left - cardRect.width / 2) / (cardRect.width / 2), 1);
          const cy = clamp((y - cardRect.top - cardRect.height / 2) / (cardRect.height / 2), 1);
          activeCard.style.setProperty('--pointer-rx', `${-cy * 3}deg`);
          activeCard.style.setProperty('--pointer-ry', `${cx * 4}deg`);
        }
        lastCard = activeCard;
        if (lastMagnet !== activeMagnet) {
          lastMagnet?.style.removeProperty('--magnet-x');
          lastMagnet?.style.removeProperty('--magnet-y');
        }
        if (activeMagnet && magnetRect) {
          activeMagnet.style.setProperty('--magnet-x', `${clamp((x - magnetRect.left - magnetRect.width / 2) * .28, 10)}px`);
          activeMagnet.style.setProperty('--magnet-y', `${clamp((y - magnetRect.top - magnetRect.height / 2) * .35, 8)}px`);
        }
        lastMagnet = activeMagnet;
        if (follower) {
          // Contain the decorative layer in the viewport, not by clipping the body.
          const fx = Math.max(46, Math.min(innerWidth - 46, x));
          const fy = Math.max(46, Math.min(innerHeight - 46, y));
          follower.style.transform = `translate3d(${fx - 46}px, ${fy - 46}px, 0)`;
          follower.style.opacity = inside ? '1' : '0';
        }
      }

      function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(paint); }
      function move(event: PointerEvent) {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        x = event.clientX; y = event.clientY; inside = true;
        activeCard = event.target instanceof Element ? event.target.closest<HTMLElement>('.portfolio-work-photo') : null;
        activeMagnet = event.target instanceof Element ? event.target.closest<HTMLElement>('.button') : null;
        schedule();
      }
      function leave() { inside = false; activeCard = null; activeMagnet = null; schedule(); }
      function scroll() { activeCard = null; activeMagnet = null; schedule(); }
      function anchor(event: MouseEvent) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]:not(.skip-link)') : null;
        const hash = link?.getAttribute('href') ?? '';
        const target = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
        if (!target) return;
        event.preventDefault();
        history.pushState(null, '', hash);
        lenis.scrollTo(target, { offset: -28, duration: 1.5 });
        // Match native hash navigation: keyboard focus continues from the target.
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
      function visibility() { if (document.hidden) leave(); else schedule(); }

      // Reveals start only on intersection: unsupported JS/observers never hide content.
      const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
        if (disposed) return;
        for (const entry of entries) {
          if (entry.isIntersecting && !revealed.has(entry.target)) {
            entry.target.classList.add('portfolio-revealed');
            revealed.add(entry.target);
            observer?.unobserve(entry.target);
          }
        }
      }, { threshold: .08 });
      function refreshWork() {
        if (!root || disposed) return;
        works = Array.from(root.querySelectorAll<HTMLElement>('.portfolio-work')).flatMap((article) => {
          const photo = article.querySelector<HTMLElement>('.portfolio-work-photo');
          return photo ? [{ article, photo }] : [];
        });
        root.querySelectorAll('[data-reveal]').forEach((el) => {
          if (revealed.has(el)) return;
          if (observer) observer.observe(el);
          else { el.classList.add('portfolio-revealed'); revealed.add(el); }
        });
        schedule();
      }
      refreshWork();
      // Category filters replace cards. Observe child changes, never our style writes.
      const mutation = new MutationObserver(refreshWork);
      mutation.observe(root, { childList: true, subtree: true });
      if (desktop.matches) {
        root.addEventListener('pointermove', move, { passive: true });
        root.addEventListener('pointerleave', leave);
      }
      root.addEventListener('click', anchor);
      window.addEventListener('scroll', scroll, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      window.addEventListener('blur', leave);
      document.addEventListener('visibilitychange', visibility);
      schedule();
      dispose = () => {
        disposed = true;
        cancelAnimationFrame(frame);
        lenis.destroy();
        scrollLock.disconnect();
        root.removeEventListener('click', anchor);
        root.style.removeProperty('--page-progress');
        lastMagnet?.style.removeProperty('--magnet-x');
        lastMagnet?.style.removeProperty('--magnet-y');
        observer?.disconnect();
        mutation.disconnect();
        root.removeEventListener('pointermove', move);
        root.removeEventListener('pointerleave', leave);
        window.removeEventListener('scroll', scroll);
        window.removeEventListener('resize', schedule);
        window.removeEventListener('blur', leave);
        document.removeEventListener('visibilitychange', visibility);
        for (const layer of layers) for (const prop of layerProperties) layer.style.removeProperty(prop);
        for (const { photo } of works) for (const prop of workProperties) photo.style.removeProperty(prop);
        lastCard?.style.removeProperty('--pointer-rx');
        lastCard?.style.removeProperty('--pointer-ry');
        if (track) { delete track.dataset.scrollProgress; track.style.removeProperty('--scene-progress'); }
        if (follower) { follower.style.removeProperty('transform'); follower.style.removeProperty('opacity'); }
        revealed.forEach((el) => el.classList.remove('portfolio-revealed'));
      };
    }
    configure();
    reduced.addEventListener('change', configure);
    desktop.addEventListener('change', configure);
    compact.addEventListener('change', configure);
    return () => {
      dispose();
      reduced.removeEventListener('change', configure);
      desktop.removeEventListener('change', configure);
      compact.removeEventListener('change', configure);
      delete root.dataset.motion;
    };
  }, []);

  return <div className="portfolio" ref={rootRef}>
    <div className="portfolio-progress" aria-hidden="true" />
    {children}
    <div className="portfolio-follower" aria-hidden="true"><Flower2 size={22} strokeWidth={1} /></div>
  </div>;
}