/**
 * Scripted stand-in for the LLM, so the repo runs with zero credentials.
 *
 * Without grounding it returns the kind of plan a general-purpose model
 * writes from pretraining: famous names, genre stereotypes, a couple of
 * confident inventions. With grounding it drafts from Qloo's candidates but,
 * like a real model, keeps one of its own habits per family so the critic
 * has something to catch. Every output is labeled "scripted" in the UI, and
 * the benchmark refuses to report numbers produced by this provider.
 */
import { ROLE_SPEC, type Brief, type PickType, type Role } from "../agent/brief";
import type { Choice, Draft, DraftInput, LLMProvider, Pick, Replacement } from "./types";

type Guess = [name: string, type: PickType, why: string];

/** "Pretraining" guesses, per family and role. Some are deliberately invented names. */
const GUESSES: Record<Brief["family"], Partial<Record<Role, Guess[]>>> = {
  music: {
    collab: [
      ["Burna Boy", "artist", "Biggest name in the genre"],
      ["Lagos Velvet Collective", "artist", "Rising Lagos collective"],
      ["Ed Sheeran", "artist", "Has collaborated across African pop"],
    ],
    sponsor: [
      ["Coors Light", "brand", "Big US music-festival sponsor"],
      ["Red Bull", "brand", "Sponsors emerging artists"],
    ],
    reference: [
      ["The Lion King", "movie", "Iconic African imagery"],
      ["Black Panther", "movie", "Afro-futurist touchstone"],
    ],
    podcast: [
      ["Afrowave Weekly", "podcast", "Afrobeats interview show"],
      ["The Joe Rogan Experience", "podcast", "Largest podcast audience"],
    ],
    venue: [["Madison Square Garden", "place", "Most famous stage in the US"]],
    presenter: [["Jimmy Fallon", "person", "Late-night music bookings"]],
    city: [["New York", "locality", "Biggest media market"]],
  },
  dtc: {
    collab: [["Taylor Swift", "artist", "Most-streamed artist with this age group"]],
    sponsor: [
      ["Ulta Beauty", "brand", "National beauty retailer"],
      ["Peachtree Glow Collective", "brand", "Atlanta indie-beauty collective"],
    ],
    reference: [
      ["Barbie", "movie", "Pink, playful, everywhere"],
      ["The Big Bang Theory", "tv_show", "Broad-appeal comfort TV"],
    ],
    podcast: [["Huberman Lab", "podcast", "Science-backed skincare talk"]],
    venue: [["Stone Mountain Park", "place", "Atlanta's best-known attraction"]],
    presenter: [["Ellen DeGeneres", "person", "Beloved, broad audience"]],
  },
  sports: {
    collab: [
      ["Imagine Dragons", "artist", "Stadium anthems"],
      ["Fred again..", "artist", "Matchday-adjacent producer"],
    ],
    sponsor: [
      ["Monster Energy", "brand", "Action-sports energy"],
      ["Coors Light", "brand", "Official beer of US sports"],
    ],
    reference: [
      ["Goal!", "movie", "The classic football movie"],
      ["Ted Lasso", "tv_show", "Made Americans love English football"],
    ],
    podcast: [
      ["Pitchside Yanks Pod", "podcast", "US soccer-fan podcast"],
      ["The Joe Rogan Experience", "podcast", "Huge male 25–44 reach"],
    ],
    venue: [["Madison Square Garden", "place", "Iconic US sports venue"]],
    presenter: [["Jake Paul", "person", "Massive young male following"]],
    city: [["Dallas", "locality", "America's sports capital"]],
  },
};

/** Which roles keep one ungrounded habit even when Qloo context is supplied. */
const HABIT: Record<Brief["family"], Role> = { music: "sponsor", dtc: "presenter", sports: "podcast" };

/** Qloo's candidates first (when grounded), then the model's own guesses; one habit survives grounding. */
function choose(input: DraftInput): Pick[] {
  const { brief, grounding } = input;
  const picks: Pick[] = [];
  const roles = (Object.keys(ROLE_SPEC) as Role[]).filter((r) => !(r === "city" && brief.targetCity));
  for (const role of roles) {
    const n = ROLE_SPEC[role].count;
    const guesses = GUESSES[brief.family][role] ?? [];
    const cands = grounding?.candidates[role] ?? [];
    const chosen: Pick[] = cands.slice(0, n).map((c) => ({
      name: c.name,
      type: c.type,
      role,
      rationale: `Qloo affinity ${c.affinity.toFixed(2)} for this audience`,
    }));
    const g = guesses[0];
    if (role === HABIT[brief.family] && g && !chosen.some((c) => c.name === g[0])) {
      if (chosen.length >= n) chosen.pop();
      chosen.push({ name: g[0], type: g[1], role, rationale: g[2] });
    }
    for (const g of guesses) {
      if (chosen.length >= n) break;
      if (!chosen.some((c) => c.name === g[0])) chosen.push({ name: g[0], type: g[1], role, rationale: g[2] });
    }
    picks.push(...chosen.slice(0, n));
  }
  return picks;
}

const first = (picks: Pick[], role: Role, i = 0, fallback = "") => picks.filter((p) => p.role === role)[i]?.name ?? fallback;

function write(brief: Brief, picks: Pick[], grounding?: DraftInput["grounding"]): Draft {
  const c1 = first(picks, "collab");
  const c2 = first(picks, "collab", 1, c1);
  const s1 = first(picks, "sponsor");
  const s2 = first(picks, "sponsor", 1, s1);
  const r1 = first(picks, "reference");
  const r2 = first(picks, "reference", 1, r1);
  const pod = first(picks, "podcast");
  const venue = first(picks, "venue");
  const host = first(picks, "presenter");
  const city = brief.targetCity ?? first(picks, "city");
  const tagLine = grounding?.tags.slice(0, 3).join(", ");
  const gap = grounding?.positioningTags?.[0];
  const { subject, product } = brief;

  if (brief.family === "music") {
    return {
      positioning: `${subject}'s ${product}: ${tagLine ? `${tagLine} ` : ""}music for people who already have ${c1} and ${c2} on repeat${gap ? ` — and lean further into ${gap} than the mainstream Afrobeats crowd` : ""}.`,
      hooks: [
        `If ${c1} is on your rotation, ${product} is your next obsession.`,
        `${r1} energy, ${city} nights. ${subject} — out now.`,
        `We asked ${host} for one word for this song. Wrong answers only.`,
      ],
      script: `0–3s: close-up, first vocal line, caption "for the ${c1} fans". 3–12s: studio-to-street cut, nod to ${r2}. 12–22s: chorus over ${city} night shots; ${s1} product in frame. 22–30s: "First show: ${venue}, ${city}" + pre-save CTA.`,
      captions: [
        { platform: "TikTok", text: `POV: ${c1} fans find ${subject} 🌅 ${product} out now. #afrofusion` },
        { platform: "Instagram Reels", text: `${product}. Made for late nights in ${city}. Link in bio.` },
        { platform: "YouTube Shorts", text: `${subject} — ${product} (visualiser). Inspired by ${r1}.` },
        { platform: "X", text: `${product} is out. If you like ${c1} and ${c2}, start here. First show: ${city}.` },
      ],
      musicBrief: `Warm, mid-tempo groove; log-drum accents; 7-second hook up front. Visual palette nods to ${r2}. Pitch to ${pod}; co-branded listening night with ${s2}.`,
      picks,
    };
  }
  if (brief.family === "dtc") {
    return {
      positioning: `${subject} enters ${city}: ${tagLine ? `${tagLine} — ` : ""}skin-first care for people who already trust ${s1}${gap ? `, with more ${gap} than the big-box alternative` : ""}.`,
      hooks: [
        `${city}, your skin routine just got a local address.`,
        `The ${r1} of skincare launches: come find us at ${venue}.`,
        `${host} tried our 3-step routine live. Here's what happened.`,
      ],
      script: `0–3s: hands, product, ${city} skyline. 3–12s: ${host} does the 3-step routine. 12–22s: pop-up at ${venue}, partner shelf with ${s2}. 22–30s: "Open this weekend" + map pin. Soundtrack: ${c1}-adjacent.`,
      captions: [
        { platform: "TikTok", text: `We're opening in ${city} 🌿 Come test the routine at ${venue}.` },
        { platform: "Instagram Reels", text: `${subject} × ${city}. Pop-up this weekend at ${venue}, with ${s1} and ${s2} on the shelf.` },
        { platform: "YouTube Shorts", text: `${host} tries ${subject} for the first time.` },
        { platform: "X", text: `${subject} is in ${city}. ${venue}, this weekend.` },
      ],
      musicBrief: `Soft, bright, ${c1}-adjacent soundtrack. Pitch the founder story to ${pod}. Mood board references ${r2}.`,
      picks,
    };
  }
  return {
    positioning: `${subject} in America: ${tagLine ? `${tagLine} — ` : ""}a club for fans who found football through ${r1}${gap ? `, built on ${gap}` : ""}.`,
    hooks: [
      `${city}, you have a club now. Watch parties start at ${venue}.`,
      `If ${r2} made you a football fan, meet your team.`,
      `${host} explains offside to a ${city} crowd.`,
    ],
    script: `0–3s: crowd roar at ${venue}. 3–12s: ${host} leads the chant. 12–22s: matchday montage scored to ${c1}; ${s1} pints on the bar. 22–30s: "Join the ${city} supporters' club" + sign-up CTA.`,
    captions: [
      { platform: "TikTok", text: `${city} supporters, this is your sign. ⚽ Watch party at ${venue}.` },
      { platform: "Instagram Reels", text: `${subject} × ${city}. Matchday is a ritual now. Powered by ${s1}.` },
      { platform: "YouTube Shorts", text: `${host} at our first ${city} watch party.` },
      { platform: "X", text: `Official ${subject} watch parties start in ${city}. Pod: ${pod}.` },
    ],
    musicBrief: `Matchday playlist anchored on ${c1} and ${c2}. Pitch the US-fans story to ${pod}. Sponsor fit: ${s2}.`,
    picks,
  };
}

/** The scripted model's own replacement ideas per role, tried in order. */
const OWN_IDEAS: Partial<Record<Role, readonly string[]>> = {
  collab: ["Burna Boy", "Wizkid"],
  sponsor: ["Telfar", "Red Bull"],
  reference: ["Insecure", "The Bear"],
  podcast: ["The Breakfast Club", "Rap Radar"],
  presenter: ["Issa Rae", "Druski"],
};

export class DeterministicLLM implements LLMProvider {
  id = "deterministic";
  label = "Scripted offline model (no LLM key set)";
  scripted = true;

  draft(input: DraftInput): Promise<Draft> {
    return Promise.resolve(write(input.brief, choose(input), input.grounding));
  }

  /** The swaps are already applied by the caller; the scripted model leaves the copy as is. */
  revise(draft: Draft): Promise<Draft> {
    return Promise.resolve(draft);
  }

  /**
   * The scripted model keeps Qloo's top option, except that it offers one idea of
   * its own per round (from a fixed list, first swap whose role has one), so the
   * offline demo exercises Qloo checking the model's own proposals too.
   */
  choose(replacements: Replacement[]): Promise<Choice[]> {
    let proposed = false;
    return Promise.resolve(
      replacements.map((r) => {
        const taken = new Set([r.from, ...(r.options ?? []).map((o) => o.name)].map((n) => n.toLowerCase()));
        const idea = proposed ? undefined : OWN_IDEAS[r.role]?.find((n) => !taken.has(n.toLowerCase()));
        if (!idea) return { from: r.from, to: r.to, why: "scripted stand-in, keeps Qloo's top option" };
        proposed = true;
        return { from: r.from, to: idea, why: "scripted stand-in's own idea, for Qloo to check", own: true };
      }),
    );
  }
}
