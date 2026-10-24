"use client";

import { useState } from "react";
import type { BriefInput } from "@/lib/agent/brief";
import { briefFromForm } from "@/lib/agent/briefForm";
import { AGE_BUCKETS, type AgeBucket } from "@/lib/qloo/types";

const AGE_LABEL = (a: string) => a.replace(/_/g, " ").replace("and younger", "& under").replace("and older", "+");

export function BriefForm({ onRun, busy }: { onRun: (b: BriefInput) => void; busy: boolean }) {
  const [subject, setSubject] = useState("");
  const [product, setProduct] = useState("");
  const [seeds, setSeeds] = useState("");
  const [link, setLink] = useState("");
  const [vibe, setVibe] = useState("");
  const [ages, setAges] = useState<AgeBucket[]>(["25_to_29", "30_to_34"]);
  const [family, setFamily] = useState<"music" | "dtc" | "sports">("music");
  const [goal, setGoal] = useState("");
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onRun(briefFromForm({ family, subject, product, seeds, link, vibe, ages, goal }));
      }}
    >
      <label className="text-caption text-muted">
        Who&apos;s launching
        <input className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-body text-ink" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Artist, brand or club" maxLength={80} />
      </label>
      <label className="text-caption text-muted">
        What
        <input className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-body text-ink" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="A single, a pop-up, a season" maxLength={120} />
      </label>
      <label className="text-caption text-muted sm:col-span-2">
        Your audience already loves (comma-separated)
        <input required={!link.trim()} className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-body text-ink" value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder="Tems, Rema, Asake" />
      </label>
      <label className="text-caption text-muted sm:col-span-2">
        The vibe, in your words (optional; mapped to Qloo taste tags)
        <input className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-body text-ink" value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="warm late-night Afro-fusion" maxLength={200} />
      </label>
      <label className="text-caption text-muted sm:col-span-2">
        Or paste a Spotify artist / IMDb link (optional)
        <input type="url" className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-body text-ink" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://open.spotify.com/artist/…" />
      </label>
      <label className="text-caption text-muted sm:col-span-2">
        Goal
        <input className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-body text-ink" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Launch to 25–34s and pick the first city" maxLength={200} />
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="text-caption text-muted">Ages</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {AGE_BUCKETS.map((a) => {
            const on = ages.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => setAges((xs) => (on ? (xs.length > 1 ? xs.filter((x) => x !== a) : xs) : [...xs, a]))}
                className={`rounded-full border px-2.5 py-1 text-caption ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}
              >
                {AGE_LABEL(a)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <select className="rounded-lg border border-line bg-bg px-2 py-1.5 text-body text-ink" value={family} onChange={(e) => setFamily(e.target.value as typeof family)} aria-label="Kind of launch">
          <option value="music">Music release</option>
          <option value="dtc">Brand / DTC</option>
          <option value="sports">Sports club</option>
        </select>
        <button disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-body font-semibold text-accent-ink disabled:opacity-50">
          Plan &amp; taste-check
        </button>
      </div>
    </form>
  );
}

