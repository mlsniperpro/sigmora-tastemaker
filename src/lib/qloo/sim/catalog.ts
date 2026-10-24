/**
 * Catalog for the offline Qloo simulator.
 *
 * THIS IS NOT QLOO DATA. Names are real public entities so the demo reads
 * naturally, but every number below (taste vectors, popularity, age and
 * gender skew, trend velocity, city scenes) is a hand-set placeholder that
 * exists only so the repo runs end to end with zero credentials. The UI
 * labels every simulated result as "simulated". Recorded live responses in
 * fixtures/qloo/ always take precedence, and the live API takes precedence
 * over both. See BLOCKED.md.
 */

export const DIMS = [
  "afro",
  "rnb",
  "hiphop",
  "alt",
  "pop",
  "heartland",
  "beauty",
  "lux",
  "street",
  "football",
  "sport",
  "comedy",
  "prestige",
  "food",
  "wellness",
] as const;
export type Dim = (typeof DIMS)[number];
export type Vec = Partial<Record<Dim, number>>;

export type SimType =
  | "artist"
  | "brand"
  | "movie"
  | "tv_show"
  | "podcast"
  | "place"
  | "person"
  | "locality";

export interface SimEntity {
  id: string;
  name: string;
  type: SimType;
  v: Vec;
  /** 0..1 */
  pop: number;
  /** 0 = 24 and younger … 1 = 55 and older */
  age: number;
  /** -1 male-skewed … +1 female-skewed */
  fem: number;
  /** -1 fading … +1 rising */
  trend: number;
  aliases?: string[];
  /** for places: the locality id they sit in; for localities: coordinates */
  city?: string;
  lat?: number;
  lon?: number;
  priceLevel?: number;
}

type Row = [name: string, v: Vec, pop: number, age: number, fem: number, trend: number, extra?: Partial<SimEntity>];

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function rows(type: SimType, list: Row[]): SimEntity[] {
  return list.map(([name, v, pop, age, fem, trend, extra]) => ({
    id: `sim-${type}-${slug(name)}`,
    name,
    type,
    v,
    pop,
    age,
    fem,
    trend,
    ...extra,
  }));
}

const ARTISTS = rows("artist", [
  ["Tems", { afro: 0.85, rnb: 0.85, alt: 0.3 }, 0.7, 0.3, 0.35, 0.3],
  ["Rema", { afro: 0.95, pop: 0.45, rnb: 0.3 }, 0.78, 0.22, 0.1, 0.2],
  ["Asake", { afro: 0.95, hiphop: 0.25, street: 0.2 }, 0.66, 0.25, -0.05, 0.25],
  ["Burna Boy", { afro: 0.95, hiphop: 0.35, rnb: 0.3 }, 0.85, 0.35, -0.1, 0.05],
  ["Wizkid", { afro: 0.95, rnb: 0.45, pop: 0.3 }, 0.84, 0.35, 0.05, -0.05],
  ["Ayra Starr", { afro: 0.9, rnb: 0.5, pop: 0.4 }, 0.6, 0.2, 0.35, 0.55],
  ["Tyla", { afro: 0.75, rnb: 0.6, pop: 0.6 }, 0.72, 0.18, 0.4, 0.3],
  ["Davido", { afro: 0.95, pop: 0.3 }, 0.78, 0.35, -0.05, -0.1],
  ["Omah Lay", { afro: 0.9, rnb: 0.6, alt: 0.25 }, 0.52, 0.26, 0.1, 0.45],
  ["Victony", { afro: 0.88, rnb: 0.45 }, 0.38, 0.24, 0.05, 0.6],
  ["Amaarae", { afro: 0.75, alt: 0.55, rnb: 0.45, lux: 0.25 }, 0.4, 0.25, 0.3, 0.4],
  ["CKay", { afro: 0.8, pop: 0.45, rnb: 0.35 }, 0.55, 0.25, 0.1, -0.35],
  ["Black Sherif", { afro: 0.85, hiphop: 0.45 }, 0.42, 0.23, -0.15, 0.35],
  ["Lucky Daye", { rnb: 0.95, alt: 0.25, afro: 0.15 }, 0.45, 0.4, 0.3, 0.15],
  ["SZA", { rnb: 0.9, pop: 0.55, alt: 0.3 }, 0.92, 0.28, 0.4, 0.1],
  ["Brent Faiyaz", { rnb: 0.9, hiphop: 0.35 }, 0.62, 0.27, 0.2, 0.2],
  ["Daniel Caesar", { rnb: 0.85, alt: 0.4 }, 0.6, 0.33, 0.3, 0.0],
  ["Jorja Smith", { rnb: 0.8, alt: 0.4, afro: 0.2 }, 0.5, 0.33, 0.35, 0.05],
  ["Kaytranada", { rnb: 0.6, alt: 0.6, afro: 0.2, hiphop: 0.25 }, 0.5, 0.3, 0.0, 0.15],
  ["Little Simz", { hiphop: 0.75, alt: 0.55, afro: 0.3 }, 0.45, 0.33, 0.1, 0.2],
  ["Drake", { hiphop: 0.9, rnb: 0.55, pop: 0.45, afro: 0.15 }, 0.97, 0.3, -0.1, -0.2],
  ["Kendrick Lamar", { hiphop: 0.95, alt: 0.3, prestige: 0.2 }, 0.95, 0.33, -0.25, 0.25],
  ["GloRilla", { hiphop: 0.9, street: 0.3 }, 0.6, 0.18, 0.2, 0.1],
  ["Taylor Swift", { pop: 0.95, heartland: 0.3 }, 0.99, 0.32, 0.55, 0.0],
  ["Ed Sheeran", { pop: 0.9, heartland: 0.25, afro: 0.05 }, 0.95, 0.45, 0.2, -0.3],
  ["Dua Lipa", { pop: 0.9, lux: 0.3, beauty: 0.2 }, 0.9, 0.28, 0.4, -0.05],
  ["Shakira", { pop: 0.85, football: 0.25 }, 0.9, 0.55, 0.3, -0.25],
  ["Coldplay", { pop: 0.7, heartland: 0.4, alt: 0.3 }, 0.95, 0.55, 0.05, -0.2],
  ["Imagine Dragons", { pop: 0.6, heartland: 0.6, sport: 0.3 }, 0.9, 0.45, -0.05, -0.35],
  ["Nickelback", { heartland: 0.85, pop: 0.2 }, 0.75, 0.78, -0.35, -0.5],
  ["Morgan Wallen", { heartland: 0.95, sport: 0.35 }, 0.93, 0.35, 0.0, 0.1],
  ["Mumford & Sons", { heartland: 0.6, alt: 0.55 }, 0.7, 0.58, 0.0, -0.4],
  ["Bob Marley", { afro: 0.3, pop: 0.45, heartland: 0.35, wellness: 0.25 }, 0.96, 0.72, -0.15, -0.3, { aliases: ["Bob Marley & The Wailers"] }],
  ["Fela Kuti", { afro: 0.7, alt: 0.4, prestige: 0.25 }, 0.6, 0.78, -0.3, -0.15],
  ["Phoebe Bridgers", { alt: 0.95, pop: 0.2 }, 0.65, 0.26, 0.45, -0.1],
  ["Arctic Monkeys", { alt: 0.9, heartland: 0.2 }, 0.85, 0.38, -0.1, -0.15],
  ["Khruangbin", { alt: 0.8, wellness: 0.25, afro: 0.15 }, 0.55, 0.38, -0.05, 0.0],
  ["Fred again..", { alt: 0.6, pop: 0.45, football: 0.15 }, 0.65, 0.25, 0.0, 0.25],
  ["Stormzy", { hiphop: 0.7, football: 0.5, afro: 0.2 }, 0.65, 0.3, -0.3, 0.1],
  ["Oasis", { alt: 0.6, heartland: 0.35, football: 0.55 }, 0.85, 0.5, -0.4, 0.45],
  ["Dave", { hiphop: 0.75, football: 0.4, prestige: 0.2 }, 0.5, 0.28, -0.35, 0.2],
]);

const BRANDS = rows("brand", [
  ["Nike", { sport: 0.7, street: 0.6, hiphop: 0.35, football: 0.35, pop: 0.3 }, 0.99, 0.35, -0.05, 0.0],
  ["Adidas", { street: 0.6, football: 0.6, sport: 0.5, hiphop: 0.3 }, 0.95, 0.33, -0.1, 0.1],
  ["Puma", { football: 0.55, street: 0.5, sport: 0.4, afro: 0.2 }, 0.8, 0.3, 0.0, 0.15],
  ["Telfar", { street: 0.8, lux: 0.4, rnb: 0.4, alt: 0.35, afro: 0.25 }, 0.4, 0.25, 0.3, 0.3],
  ["Fenty Beauty", { beauty: 0.85, rnb: 0.55, pop: 0.35, afro: 0.3 }, 0.82, 0.27, 0.85, 0.1],
  ["Glossier", { beauty: 0.9, alt: 0.35, pop: 0.35, wellness: 0.3 }, 0.72, 0.25, 0.85, -0.1],
  ["The Ordinary", { beauty: 0.85, wellness: 0.4, alt: 0.2 }, 0.76, 0.28, 0.7, 0.05],
  ["Rare Beauty", { beauty: 0.85, pop: 0.5, wellness: 0.3 }, 0.78, 0.2, 0.85, 0.15],
  ["Topicals", { beauty: 0.85, afro: 0.45, rnb: 0.35, wellness: 0.35 }, 0.35, 0.24, 0.8, 0.5],
  ["Mielle Organics", { beauty: 0.8, rnb: 0.4, afro: 0.3, wellness: 0.35 }, 0.5, 0.33, 0.85, 0.3],
  ["Bread Beauty Supply", { beauty: 0.8, alt: 0.3, rnb: 0.3 }, 0.28, 0.27, 0.8, 0.35],
  ["Aesop", { lux: 0.7, beauty: 0.6, alt: 0.45, wellness: 0.4 }, 0.55, 0.42, 0.4, 0.05],
  ["Sephora", { beauty: 0.85, pop: 0.45, lux: 0.35 }, 0.92, 0.3, 0.8, 0.0],
  ["Ulta Beauty", { beauty: 0.8, pop: 0.5 }, 0.85, 0.35, 0.8, -0.05],
  ["Erewhon", { wellness: 0.85, lux: 0.6, food: 0.5, beauty: 0.3 }, 0.45, 0.32, 0.45, 0.2],
  ["Sweetgreen", { wellness: 0.65, food: 0.6 }, 0.6, 0.33, 0.4, -0.05],
  ["Supreme", { street: 0.9, hiphop: 0.4 }, 0.75, 0.25, -0.4, -0.3],
  ["Aimé Leon Dore", { street: 0.75, lux: 0.55, football: 0.2 }, 0.4, 0.3, -0.35, 0.2],
  ["Kith", { street: 0.8, lux: 0.4, sport: 0.3 }, 0.5, 0.28, -0.3, 0.0],
  ["Red Bull", { sport: 0.6, street: 0.3, alt: 0.2, football: 0.3 }, 0.95, 0.3, -0.35, 0.0],
  ["Monster Energy", { sport: 0.55, heartland: 0.55 }, 0.85, 0.32, -0.55, -0.1],
  ["Coors Light", { heartland: 0.9, sport: 0.45 }, 0.8, 0.5, -0.4, -0.25],
  ["Heineken", { football: 0.7, sport: 0.4, pop: 0.2 }, 0.85, 0.42, -0.35, 0.0],
  ["Guinness", { football: 0.55, heartland: 0.3, afro: 0.3, food: 0.2 }, 0.8, 0.48, -0.4, 0.2],
  ["Wingstop", { hiphop: 0.6, food: 0.65, sport: 0.45 }, 0.75, 0.28, -0.15, 0.2],
  ["Cracker Barrel", { heartland: 0.9, food: 0.5 }, 0.75, 0.75, 0.05, -0.4],
  ["Apple Music", { pop: 0.5, hiphop: 0.4, rnb: 0.35, afro: 0.25 }, 0.9, 0.32, 0.0, 0.0],
  ["Spotify", { pop: 0.55, alt: 0.4, afro: 0.25, hiphop: 0.3 }, 0.97, 0.28, 0.05, 0.0],
  ["Boiler Room", { alt: 0.65, afro: 0.45, street: 0.35 }, 0.45, 0.25, -0.1, 0.3],
  ["Premier League", { football: 0.95, sport: 0.4 }, 0.85, 0.38, -0.55, 0.1],
  ["Arsenal F.C.", { football: 0.95, street: 0.2, afro: 0.15 }, 0.75, 0.35, -0.5, 0.25, { aliases: ["Arsenal"] }],
  ["EA Sports FC", { football: 0.85, sport: 0.4, hiphop: 0.2 }, 0.85, 0.2, -0.75, 0.05],
  ["Harley-Davidson", { heartland: 0.85 }, 0.75, 0.68, -0.7, -0.35],
]);

const TV = rows("tv_show", [
  ["Insecure", { rnb: 0.65, comedy: 0.55, prestige: 0.55, afro: 0.15 }, 0.65, 0.35, 0.55, -0.25],
  ["Atlanta", { hiphop: 0.6, comedy: 0.5, prestige: 0.7, alt: 0.3 }, 0.62, 0.38, -0.05, -0.2],
  ["Abbott Elementary", { comedy: 0.85, pop: 0.3 }, 0.75, 0.42, 0.35, 0.15],
  ["Love Island USA", { pop: 0.7, beauty: 0.45 }, 0.72, 0.2, 0.7, 0.45],
  ["The Bear", { food: 0.75, prestige: 0.75, alt: 0.3 }, 0.7, 0.4, 0.1, -0.1],
  ["Euphoria", { pop: 0.5, prestige: 0.55, beauty: 0.4, rnb: 0.25 }, 0.8, 0.18, 0.4, -0.2],
  ["Ted Lasso", { football: 0.75, comedy: 0.65, heartland: 0.2 }, 0.75, 0.48, 0.1, -0.15],
  ["Welcome to Wrexham", { football: 0.9, comedy: 0.3, sport: 0.4 }, 0.55, 0.45, -0.35, 0.3],
  ["Yellowstone", { heartland: 0.95, prestige: 0.2 }, 0.85, 0.65, -0.1, -0.2],
  ["The Big Bang Theory", { comedy: 0.6, pop: 0.4, heartland: 0.3 }, 0.9, 0.55, 0.0, -0.45],
  ["Shōgun", { prestige: 0.9, alt: 0.2 }, 0.65, 0.5, -0.1, 0.0, { aliases: ["Shogun"] }],
  ["Big Mouth", { comedy: 0.7, alt: 0.3 }, 0.55, 0.25, 0.0, -0.3],
]);

const MOVIES = rows("movie", [
  ["Black Panther: Wakanda Forever", { afro: 0.5, pop: 0.5, prestige: 0.3 }, 0.85, 0.38, 0.15, -0.45, { aliases: ["Wakanda Forever"] }],
  ["Black Panther", { afro: 0.45, pop: 0.55, prestige: 0.3, hiphop: 0.25 }, 0.9, 0.4, 0.0, -0.5],
  ["The Lion King", { pop: 0.6, heartland: 0.3 }, 0.95, 0.5, 0.2, -0.45],
  ["The Woman King", { afro: 0.55, prestige: 0.5 }, 0.6, 0.45, 0.45, -0.25],
  ["Sinners", { rnb: 0.5, hiphop: 0.3, prestige: 0.75, alt: 0.25 }, 0.8, 0.35, 0.05, 0.35],
  ["Top Gun: Maverick", { heartland: 0.75, sport: 0.3 }, 0.9, 0.55, -0.45, -0.35],
  ["Barbie", { pop: 0.8, beauty: 0.4, comedy: 0.3 }, 0.92, 0.3, 0.65, -0.4],
  ["Goal!", { football: 0.8, sport: 0.3 }, 0.4, 0.55, -0.5, -0.3],
]);

const PODCASTS = rows("podcast", [
  ["Afrobeats Intelligence", { afro: 0.95, prestige: 0.2 }, 0.25, 0.32, 0.0, 0.4],
  ["The Breakfast Club", { hiphop: 0.75, rnb: 0.55, comedy: 0.3 }, 0.8, 0.4, -0.05, -0.2],
  ["Rap Radar", { hiphop: 0.95 }, 0.55, 0.35, -0.45, 0.0],
  ["Call Her Daddy", { pop: 0.55, beauty: 0.4, comedy: 0.3 }, 0.85, 0.22, 0.85, 0.0],
  ["The Joe Rogan Experience", { heartland: 0.5, comedy: 0.5, sport: 0.4, wellness: 0.2 }, 0.98, 0.45, -0.7, -0.1],
  ["Men in Blazers", { football: 0.95, comedy: 0.35 }, 0.5, 0.42, -0.6, 0.2],
  ["The Rest Is Football", { football: 0.95 }, 0.6, 0.45, -0.7, 0.35],
  ["Club Shay Shay", { sport: 0.65, hiphop: 0.55, comedy: 0.4 }, 0.7, 0.4, -0.4, 0.15],
  ["Hot Ones", { food: 0.55, comedy: 0.55, hiphop: 0.35, pop: 0.3 }, 0.85, 0.3, -0.2, 0.0],
  ["Huberman Lab", { wellness: 0.85 }, 0.85, 0.42, -0.45, -0.1],
  ["Armchair Expert", { comedy: 0.5, pop: 0.4, wellness: 0.3 }, 0.82, 0.48, 0.3, -0.15],
  ["Las Culturistas", { pop: 0.65, comedy: 0.7, alt: 0.2 }, 0.45, 0.3, 0.4, 0.1],
  ["Pretty Basic", { beauty: 0.8, pop: 0.5 }, 0.4, 0.22, 0.85, -0.2],
  ["Tiny Desk Concerts", { alt: 0.6, rnb: 0.5, afro: 0.3, hiphop: 0.3 }, 0.7, 0.38, 0.1, 0.15, { aliases: ["NPR Tiny Desk"] }],
]);

const PEOPLE = rows("person", [
  ["Issa Rae", { rnb: 0.5, comedy: 0.6, prestige: 0.55 }, 0.7, 0.38, 0.55, -0.1],
  ["Druski", { comedy: 0.85, hiphop: 0.6 }, 0.7, 0.25, -0.3, 0.2],
  ["Keith Lee", { food: 0.9, comedy: 0.35, hiphop: 0.25 }, 0.75, 0.3, -0.05, 0.25],
  ["Alix Earle", { beauty: 0.8, pop: 0.7 }, 0.65, 0.15, 0.85, 0.0],
  ["Jackie Aina", { beauty: 0.9, afro: 0.45, rnb: 0.35 }, 0.5, 0.33, 0.85, 0.15],
  ["Mikayla Nogueira", { beauty: 0.85, pop: 0.45 }, 0.55, 0.22, 0.85, -0.3],
  ["Jake Paul", { sport: 0.55, pop: 0.35 }, 0.85, 0.18, -0.65, -0.35],
  ["Thierry Henry", { football: 0.9, sport: 0.3 }, 0.7, 0.45, -0.55, 0.1],
  ["Micah Richards", { football: 0.85, comedy: 0.45 }, 0.45, 0.4, -0.5, 0.3],
  ["IShowSpeed", { football: 0.6, hiphop: 0.35, comedy: 0.4 }, 0.85, 0.05, -0.75, 0.35, { aliases: ["Speed"] }],
  ["Trevor Noah", { comedy: 0.8, afro: 0.3, prestige: 0.35 }, 0.75, 0.45, 0.1, -0.05],
  ["Jimmy Fallon", { comedy: 0.6, pop: 0.5, heartland: 0.3 }, 0.85, 0.6, 0.05, -0.4],
  ["Ellen DeGeneres", { comedy: 0.5, pop: 0.45 }, 0.85, 0.7, 0.45, -0.55],
  ["Joey Akan", { afro: 0.9, prestige: 0.2 }, 0.2, 0.33, 0.0, 0.4],
]);

const LOCALITIES = rows("locality", [
  ["Houston", { afro: 0.8, hiphop: 0.8, rnb: 0.6, sport: 0.7, heartland: 0.4, food: 0.7, beauty: 0.4 }, 0.85, 0.42, 0.0, 0.1, { lat: 29.76, lon: -95.37, aliases: ["Houston, TX"] }],
  ["Atlanta", { hiphop: 0.95, rnb: 0.9, afro: 0.65, beauty: 0.65, street: 0.6, food: 0.5, sport: 0.5 }, 0.85, 0.38, 0.1, 0.15, { lat: 33.75, lon: -84.39, aliases: ["Atlanta, GA"] }],
  ["Washington", { afro: 0.85, rnb: 0.7, hiphop: 0.55, alt: 0.4, football: 0.55, prestige: 0.4 }, 0.8, 0.4, 0.05, 0.1, { lat: 38.91, lon: -77.04, aliases: ["Washington, DC", "DC"] }],
  ["New York", { afro: 0.7, alt: 0.7, lux: 0.8, street: 0.8, pop: 0.6, football: 0.7, food: 0.8, prestige: 0.7, beauty: 0.6 }, 0.98, 0.4, 0.05, 0.05, { lat: 40.71, lon: -74.0, aliases: ["New York City", "NYC", "Brooklyn"] }],
  ["Chicago", { football: 0.75, alt: 0.6, hiphop: 0.6, food: 0.7, sport: 0.7, rnb: 0.4 }, 0.88, 0.42, 0.0, 0.05, { lat: 41.88, lon: -87.63 }],
  ["Los Angeles", { pop: 0.8, beauty: 0.8, lux: 0.7, alt: 0.6, street: 0.7, prestige: 0.6, wellness: 0.7 }, 0.95, 0.38, 0.1, 0.0, { lat: 34.05, lon: -118.24, aliases: ["LA"] }],
  ["Dallas", { heartland: 0.6, sport: 0.8, hiphop: 0.6, afro: 0.5, food: 0.5 }, 0.82, 0.42, 0.0, 0.1, { lat: 32.78, lon: -96.8 }],
  ["Minneapolis", { alt: 0.7, heartland: 0.5, afro: 0.35, sport: 0.5 }, 0.6, 0.45, 0.0, 0.0, { lat: 44.98, lon: -93.27 }],
  ["Seattle", { alt: 0.8, football: 0.7, wellness: 0.6, food: 0.5 }, 0.72, 0.4, 0.0, 0.05, { lat: 47.61, lon: -122.33 }],
  ["Nashville", { heartland: 0.95, alt: 0.4, pop: 0.4 }, 0.7, 0.42, 0.05, 0.2, { lat: 36.16, lon: -86.78 }],
  ["Phoenix", { heartland: 0.6, sport: 0.6, wellness: 0.3 }, 0.7, 0.5, 0.0, 0.1, { lat: 33.45, lon: -112.07 }],
  ["Boston", { alt: 0.6, sport: 0.8, football: 0.45, prestige: 0.5 }, 0.75, 0.42, 0.0, 0.0, { lat: 42.36, lon: -71.06 }],
  ["Miami", { lux: 0.7, pop: 0.6, hiphop: 0.6, football: 0.65, beauty: 0.5 }, 0.8, 0.42, 0.05, 0.15, { lat: 25.76, lon: -80.19 }],
  ["Denver", { alt: 0.6, wellness: 0.65, heartland: 0.45, sport: 0.5 }, 0.65, 0.4, 0.0, 0.1, { lat: 39.74, lon: -104.99 }],
]);

const city = (name: string) => `sim-locality-${slug(name)}`;

const PLACES = rows("place", [
  ["White Oak Music Hall", { alt: 0.65, hiphop: 0.35, afro: 0.3 }, 0.45, 0.33, 0.0, 0.1, { city: city("Houston"), priceLevel: 2 }],
  ["House of Blues Houston", { rnb: 0.45, pop: 0.45, heartland: 0.35, hiphop: 0.35 }, 0.6, 0.45, 0.0, -0.1, { city: city("Houston"), priceLevel: 2 }],
  ["The Masquerade", { alt: 0.7, hiphop: 0.4 }, 0.5, 0.3, -0.05, 0.0, { city: city("Atlanta"), priceLevel: 2 }],
  ["Tabernacle", { rnb: 0.55, hiphop: 0.5, pop: 0.4, afro: 0.35 }, 0.6, 0.35, 0.05, 0.05, { city: city("Atlanta"), priceLevel: 2 }],
  ["Echostage", { afro: 0.65, alt: 0.45, rnb: 0.35 }, 0.55, 0.27, 0.0, 0.2, { city: city("Washington"), priceLevel: 2 }],
  ["Howard Theatre", { rnb: 0.75, afro: 0.45, hiphop: 0.45 }, 0.45, 0.4, 0.15, 0.1, { city: city("Washington"), priceLevel: 2 }],
  ["9:30 Club", { alt: 0.8, pop: 0.3 }, 0.55, 0.4, 0.0, 0.0, { city: city("Washington"), priceLevel: 2 }],
  ["SOB's", { afro: 0.85, rnb: 0.5, hiphop: 0.4 }, 0.4, 0.33, 0.05, 0.15, { city: city("New York"), priceLevel: 2, aliases: ["Sounds of Brazil", "SOBs"] }],
  ["Brooklyn Steel", { alt: 0.85, pop: 0.25 }, 0.55, 0.32, 0.0, 0.05, { city: city("New York"), priceLevel: 2 }],
  ["Madison Square Garden", { pop: 0.6, sport: 0.6, heartland: 0.35 }, 0.95, 0.5, -0.1, -0.05, { city: city("New York"), priceLevel: 4, aliases: ["MSG"] }],
  ["Metro Chicago", { alt: 0.85 }, 0.45, 0.38, -0.05, 0.0, { city: city("Chicago"), priceLevel: 2, aliases: ["Metro"] }],
  ["The Globe Pub", { football: 0.95, food: 0.3 }, 0.3, 0.42, -0.5, 0.15, { city: city("Chicago"), priceLevel: 2 }],
  ["Fado Irish Pub", { football: 0.6, heartland: 0.3, food: 0.3 }, 0.35, 0.45, -0.35, -0.1, { city: city("Chicago"), priceLevel: 2 }],
  ["Smithfield Hall", { football: 0.9, food: 0.25 }, 0.3, 0.4, -0.45, 0.1, { city: city("New York"), priceLevel: 2 }],
  ["Lucky's Pub", { football: 0.65, sport: 0.6 }, 0.3, 0.4, -0.4, 0.05, { city: city("Houston"), priceLevel: 1 }],
  ["Atlantic Crossing", { football: 0.9, food: 0.3 }, 0.3, 0.4, -0.45, 0.15, { city: city("Seattle"), priceLevel: 2 }],
  ["George & Dragon Pub", { football: 0.85, heartland: 0.2 }, 0.3, 0.45, -0.45, 0.0, { city: city("Seattle"), priceLevel: 2 }],
  ["Climate Pledge Arena", { sport: 0.6, pop: 0.5, alt: 0.3 }, 0.8, 0.42, -0.1, 0.1, { city: city("Seattle"), priceLevel: 3 }],
  ["Neumos", { alt: 0.8, hiphop: 0.3 }, 0.4, 0.32, 0.0, 0.05, { city: city("Seattle"), priceLevel: 2 }],
  ["Ponce City Market", { food: 0.65, beauty: 0.35, lux: 0.35, alt: 0.3 }, 0.6, 0.35, 0.3, 0.1, { city: city("Atlanta"), priceLevel: 2 }],
  ["Westside Provisions District", { lux: 0.65, beauty: 0.45, food: 0.4 }, 0.4, 0.38, 0.35, 0.15, { city: city("Atlanta"), priceLevel: 3 }],
  ["Krog Street Market", { food: 0.75, alt: 0.3 }, 0.45, 0.35, 0.1, 0.05, { city: city("Atlanta"), priceLevel: 2 }],
  ["Lenox Square", { pop: 0.5, lux: 0.45, beauty: 0.35 }, 0.7, 0.45, 0.35, -0.15, { city: city("Atlanta"), priceLevel: 3 }],
  ["Stone Mountain Park", { heartland: 0.7, sport: 0.3 }, 0.6, 0.6, 0.0, -0.2, { city: city("Atlanta"), priceLevel: 1 }],
]);

export const CATALOG: SimEntity[] = [
  ...ARTISTS,
  ...BRANDS,
  ...TV,
  ...MOVIES,
  ...PODCASTS,
  ...PEOPLE,
  ...LOCALITIES,
  ...PLACES,
];

/** Taste tags; each lives on one dimension. */
export const TAGS: { id: string; name: string; dim: Dim; subtype: string }[] = (
  [
    ["afrobeats", "afro", "genre"],
    ["afro-fusion", "afro", "genre"],
    ["amapiano", "afro", "genre"],
    ["west african diaspora", "afro", "keyword"],
    ["alternative r&b", "rnb", "genre"],
    ["neo-soul", "rnb", "genre"],
    ["late-night romance", "rnb", "keyword"],
    ["trap", "hiphop", "genre"],
    ["rap culture", "hiphop", "keyword"],
    ["indie rock", "alt", "genre"],
    ["left-field", "alt", "keyword"],
    ["chart pop", "pop", "genre"],
    ["singalong anthems", "pop", "keyword"],
    ["country", "heartland", "genre"],
    ["small-town nostalgia", "heartland", "keyword"],
    ["clean beauty", "beauty", "keyword"],
    ["skin-first routines", "beauty", "keyword"],
    ["quiet luxury", "lux", "keyword"],
    ["design-led", "lux", "keyword"],
    ["streetwear", "street", "keyword"],
    ["sneaker drops", "street", "keyword"],
    ["matchday rituals", "football", "keyword"],
    ["supporters' culture", "football", "keyword"],
    ["big-game watch parties", "sport", "keyword"],
    ["deadpan comedy", "comedy", "keyword"],
    ["prestige drama", "prestige", "genre"],
    ["auteur cinema", "prestige", "keyword"],
    ["street food", "food", "keyword"],
    ["chef-driven", "food", "keyword"],
    ["self-care", "wellness", "keyword"],
    ["ingredient-conscious", "wellness", "keyword"],
  ] as [string, Dim, string][]
).map(([name, dim, sub]) => ({ id: `urn:tag:${sub}:sim:${slug(name)}`, name, dim, subtype: `urn:tag:${sub}:qloo` }));

export const byId = new Map(CATALOG.map((e) => [e.id, e]));
