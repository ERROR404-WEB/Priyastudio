'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="share-loading"><h1>A little pause.</h1><p>This page couldn’t load. Your saved data has not been reset. Please try again.</p><button className="button" onClick={reset}>Try again</button></main>;
}