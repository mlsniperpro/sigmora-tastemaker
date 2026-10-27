import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found · Tastemaker by Sigmora" };

const REPO = "https://github.com/mlsniperpro/sigmora-tastemaker";

/** Any unknown path: stay on brand and send the visitor back to the demo or to the repo's docs. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 px-4 py-12">
      <p className="text-meta font-semibold uppercase tracking-wider text-muted">404</p>
      <h1 className="text-2xl font-bold text-ink">This page isn&apos;t part of Tastemaker.</h1>
      <p className="text-body text-muted">The demo lives on one page. The docs (judge path, benchmark method, responsible taste) live in the repo.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="rounded-full bg-accent px-4 py-2 text-body font-semibold text-accent-ink">
          Back to the demo
        </Link>
        <a href={`${REPO}/blob/main/docs/judging.md`} className="rounded-full border border-line px-4 py-2 text-body text-ink hover:border-violet">
          Read the judging guide
        </a>
      </div>
    </main>
  );
}
