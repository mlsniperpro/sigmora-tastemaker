/**
 * The "Try a sample" text for the audit panel: the kind of launch plan a
 * general-purpose chatbot writes for the hero brief (an Afro-fusion single,
 * fans of Tems, Rema and Asake, 25–34). It names famous safe bets, a couple
 * of genre stereotypes and two names nobody can find (Kemi Adebayo-Rhodes,
 * The Highlife Hour), which is what the audit exists to catch. Plain
 * constants: the browser imports this.
 */
import type { AgeBucket } from "./vocab";

export const AUDIT_SAMPLE_AUDIENCE: { seeds: string[]; ages: AgeBucket[] } = { seeds: ["Tems", "Rema", "Asake"], ages: ["25_to_29", "30_to_34"] };

export const AUDIT_SAMPLE = `Launch plan: Nia Sol – "Harmattan Love" (debut single)

Positioning: Warm, late-night Afro-fusion for 25–34-year-olds who live on Afrobeats playlists.

Collab targets: Ayra Starr, Ed Sheeran, Kemi Adebayo-Rhodes
Brand partners: Fenty Beauty, Coors Light
Hook references: Insecure, Black Panther
Podcast pitch: Afrobeats Intelligence, The Highlife Hour
Presenter: Jimmy Fallon
Launch city: New York
Venue: Madison Square Garden

Week 1 – Tease: 15-second clips of the chorus on TikTok and Reels, shot like a scene from Insecure.
Week 2 – Drop: a release-night listening party for fans of Burna Boy and Wizkid.
Week 3 – Live: the first headline show, with a pre-save push on Spotify.`;
