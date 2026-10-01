'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Flower2, LockKeyhole } from 'lucide-react';
import { ApiError, normalizePhone, requestJSON } from '@/lib/client';
import { ErrorNotice, Field, formText, useTask } from '@/components/ui/studio-primitives';
import { StudioLogo } from '@/components/studio/shell';
import '@/components/studio/studio.css';

export default function LoginPage() {
  const router = useRouter();
  const task = useTask();
  const [demo, setDemo] = useState(false);
  const [setup, setSetup] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void requestJSON<{ demo: boolean }>('/api/studio', { signal: controller.signal }).then((result) => {
      if (result.demo === true) setDemo(true);
      else if (result.demo === false) router.replace('/studio');
    }).catch((error: unknown) => { if (error instanceof ApiError && error.status === 503) setSetup(error.message); });
    return () => controller.abort();
  }, [router]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = formText(event, 'phone');
    // Passwords must not be trimmed or otherwise normalized.
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    void task.run(async () => {
      const username = normalizePhone(phone);
      if (!/^\+?[\d\s()-]+$/.test(phone) || !/^\d{7,15}$/.test(username)) throw new Error('Enter your registered phone number, including the country code if it was configured with one.');
      await requestJSON('/api/auth/sign-in/username', { method: 'POST', body: JSON.stringify({ username, password }) });
      // A successful auth response alone is not an authorization decision.
      const verified = await requestJSON<{ demo: boolean }>('/api/studio');
      if (verified.demo) throw new Error('This workspace is a local demo. Use the clearly labeled demo link below instead of signing in.');
      router.replace('/studio'); router.refresh();
    });
  }
  return <main className="studio-login"><section className="studio-login-story"><Image src="/images/cafe.jpg" alt="A quiet café moment, ready for a new story" fill unoptimized priority sizes="(max-width: 850px) 100vw, 50vw" /><div className="studio-login-story-shade" /><Link href="/" className="studio-login-back"><ArrowLeft size={17} /> Back to the lovely things</Link><div className="studio-login-story-copy"><Flower2 size={56} strokeWidth={0.8} /><span className="studio-eyebrow">THE SPACE BEHIND THE STORIES</span><h1>A little creativity.<br /><em>A lot of you.</em></h1><p>For the ideas on your mind,<br />and the stories only you can tell.</p></div><span className="studio-login-story-footer">HEY PRIYA · MADE OF LITTLE MOMENTS</span></section><section className="studio-login-panel"><Link href="/" className="studio-logo-link"><StudioLogo /></Link><div className="studio-login-form"><span className="studio-eyebrow">YOUR CREATIVE CORNER</span><h2>Welcome home, Priya.</h2><p className="studio-muted">A fresh idea, a little coffee, and your very own studio.</p>{setup && <div className="studio-error" role="alert"><strong>Your studio needs a little setup.</strong><p>{setup}</p><p>The owner must finish production configuration. Demo access is never substituted for authentication.</p></div>}<form onSubmit={submit}><fieldset className="studio-fieldset" disabled={task.pending}><Field label="Your phone number" hint="Use your registered number, including its country code if configured. Spaces and + signs are removed before sign-in."><input className="studio-input" name="phone" type="tel" autoComplete="username" required maxLength={24} placeholder="+91 98765 43210" /></Field><Field label="Password"><span className="studio-password-input"><input className="studio-input" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} placeholder="Your private little key" /><button type="button" className="studio-icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></Field></fieldset><ErrorNotice message={task.error} /><button className="studio-button studio-login-submit" type="submit" disabled={task.pending || !!setup}>{task.pending ? 'Opening your studio…' : 'Step into your studio'}<ArrowRight size={18} /></button></form>{demo && <div className="studio-login-demo"><span className="studio-demo-badge">LOCAL DEMO · SYNTHETIC EXAMPLES</span><p>Take a look around with sample data. No sign-in required in this local demo.</p><Link href="/studio" className="studio-button studio-button-secondary">Try demo studio <ArrowRight size={17} /></Link></div>}<p className="studio-login-private"><LockKeyhole size={14} /> A private space for one creator. No public signups.</p></div><div className="studio-login-footer">Less admin. More of what you love. <Flower2 size={17} /></div></section></main>;
}