import Link from 'next/link';
import { Flower2 } from 'lucide-react';
export default function NotFound() {
  return <main className="share-loading"><Flower2 size={45} strokeWidth={1} /><span className="eyebrow">A LITTLE DETOUR</span><h1>This story isn’t here.</h1><p>The page may have moved. Let’s find our way back to something lovely.</p><Link className="button" href="/">Back to the portfolio</Link></main>;
}