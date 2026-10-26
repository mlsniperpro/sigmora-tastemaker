"use client";

import { useId, useState } from "react";
import type { Brief, BriefInput } from "@/lib/agent/brief";
import { briefFormProblem, briefFromForm, type FormFields } from "@/lib/agent/briefForm";
import { AGE_BUCKETS, type AgeBucket } from "@/lib/vocab";

export const AGE_LABEL = (a: string) => a.replace(/_/g, " ").replace("and younger", "& under").replace("and older", "+");
export const INPUT = "mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-body text-ink aria-[invalid=true]:border-miss";

export function Chips<T extends string>({ label, options, selected, toggle, name }: { label: string; options: readonly T[]; selected: (o: T) => boolean; toggle: (o: T) => void; name: (o: T) => string }) {
  return (
    <fieldset>
      <legend className="text-caption text-muted">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={selected(o)}
            onClick={() => toggle(o)}
            className={`rounded-full border px-2.5 py-1 text-caption ${selected(o) ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}
          >
            {name(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const EMPTY_FIELDS: FormFields = { family: "music", subject: "", product: "", seeds: "", link: "", vibe: "", ages: ["25_to_29", "30_to_34"], goal: "", city: "", compareTo: "" };

/** A brief laid back into the form's fields (the reverse of `briefFromForm`), so it can be edited. */
export function fieldsFromBrief(b: Brief): FormFields {
  return {
    family: b.family,
    subject: b.subject,
    product: b.product,
    seeds: b.seeds.join(", "),
    link: b.seedLinks[0] ?? "",
    vibe: b.vibe ?? "",
    ages: [...b.ages],
    gender: b.gender,
    goal: b.goal,
    city: b.targetCity ?? "",
    compareTo: b.compareTo ?? "",
  };
}

/**
 * The brief bar: who's launching, who the audience loves (names or a Spotify/IMDb link) and their ages up front; the rest on demand.
 * `current` is the brief on screen: the fields start from it, and follow it whenever a different run is shown.
 */
export function BriefForm({ onRun, busy, current }: { onRun: (b: BriefInput) => void; busy: boolean; current?: { id: string; brief: Brief } }) {
  const id = useId();
  const [f, setF] = useState<FormFields>(current ? fieldsFromBrief(current.brief) : EMPTY_FIELDS);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<ReturnType<typeof briefFormProblem>>();
  // Adjusting state while rendering (not in an effect): a new run on screen replaces the fields with its brief.
  const [shownRun, setShownRun] = useState(current?.id);
  if (current && current.id !== shownRun) {
    setShownRun(current.id);
    setF(fieldsFromBrief(current.brief));
    setProblem(undefined);
  }
  const set = <K extends keyof FormFields>(k: K) => (v: FormFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: "subject" | "product" | "seeds" | "link" | "vibe" | "goal" | "city" | "compareTo") => ({
    id: `${id}-${k}`,
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      set(k)(e.target.value);
      if (problem?.field === k) setProblem(undefined);
    },
    ...(problem?.field === k ? { "aria-invalid": true, "aria-describedby": `${id}-problem` } : {}),
  });
  return (
    <form
      aria-label="Your own brief"
      className="space-y-2 rounded-xl border border-dashed border-line p-3"
      // Checked by briefFormProblem, which says what's missing in this form's words.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const bad = briefFormProblem(f);
        setProblem(bad);
        if (bad) document.getElementById(`${id}-${bad.field}`)?.focus();
        else {
          const brief = briefFromForm(f);
          // The form has no field for the metros to compare, so an edited brief keeps the ones it came with.
          const kept = current?.brief.candidateCities;
          onRun(!brief.targetCity && kept?.length ? { ...brief, candidateCities: kept } : brief);
        }
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="text-caption text-muted">
          Who&apos;s launching
          <input required className={INPUT} {...text("subject")} placeholder="Artist, brand or club" maxLength={80} />
        </label>
        <label className="text-caption text-muted">
          Your audience already loves (comma-separated)
          <input required={!f.link.trim()} className={INPUT} {...text("seeds")} placeholder="Tems, Rema, Asake" />
        </label>
        <label className="text-caption text-muted">
          …or a Spotify artist / IMDb link
          <input type="url" className={INPUT} {...text("link")} placeholder="https://open.spotify.com/artist/…" />
        </label>
        <button disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-body font-semibold text-accent-ink disabled:opacity-50">
          Plan &amp; taste-check
        </button>
      </div>
      {problem && (
        <p id={`${id}-problem`} role="alert" className="text-body text-miss">
          {problem.message}
        </p>
      )}
      <Chips
        label="Ages"
        options={AGE_BUCKETS}
        selected={(a) => f.ages.includes(a)}
        toggle={(a: AgeBucket) => set("ages")(f.ages.includes(a) ? (f.ages.length > 1 ? f.ages.filter((x) => x !== a) : f.ages) : [...f.ages, a])}
        name={AGE_LABEL}
      />
      <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="text-caption text-violet hover:underline">
        {more ? "Fewer details" : "More details: what's launching, city, gender, comparable, vibe, goal"}
      </button>
      {more && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-caption text-muted">
            What
            <input className={INPUT} {...text("product")} placeholder="A single, a pop-up, a season" maxLength={120} />
          </label>
          <label className="text-caption text-muted">
            City (leave empty and Tastemaker picks one)
            <input className={INPUT} {...text("city")} placeholder="Atlanta" maxLength={40} />
          </label>
          <label className="text-caption text-muted">
            Position against (a comparable artist or brand)
            <input className={INPUT} {...text("compareTo")} placeholder="Burna Boy" maxLength={80} />
          </label>
          <label className="text-caption text-muted sm:col-span-2">
            The vibe, in your words (mapped to Qloo taste tags)
            <input className={INPUT} {...text("vibe")} placeholder="warm late-night Afro-fusion" maxLength={200} />
          </label>
          <label className="text-caption text-muted sm:col-span-2">
            Goal
            <input className={INPUT} {...text("goal")} placeholder="Launch to 25–34s and pick the first city" maxLength={200} />
          </label>
          <Chips
            label="Gender skew (optional)"
            options={["female", "male"] as const}
            selected={(g) => f.gender === g}
            toggle={(g) => set("gender")(f.gender === g ? undefined : g)}
            name={(g) => g}
          />
          <label className="text-caption text-muted">
            Kind of launch
            <select className={INPUT} value={f.family} onChange={(e) => set("family")(e.target.value as FormFields["family"])}>
              <option value="music">Music release</option>
              <option value="dtc">Brand / DTC</option>
              <option value="sports">Sports club</option>
            </select>
          </label>
        </div>
      )}
    </form>
  );
}
