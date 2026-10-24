/** The 30 Culture Miss Rate briefs: 10 per preset family. */
import type { BriefInput } from "../src/lib/agent/brief";
import { PRESETS } from "../src/lib/agent/presets";

const METROS = PRESETS[0].brief.candidateCities!;
type A = BriefInput["ages"];
const YOUNG: A = ["24_and_younger", "25_to_29"];
const CORE: A = ["25_to_29", "30_to_34"];
const MID: A = ["30_to_34", "35_to_44"];

const music = (subject: string, seeds: string[], ages: A): BriefInput => ({
  family: "music",
  subject,
  product: "new single",
  seeds,
  ages,
  goal: "Launch the single and pick the first city to play.",
  candidateCities: METROS,
});
const dtc = (subject: string, seeds: string[], targetCity: string, ages: A, gender?: "female" | "male"): BriefInput => ({
  family: "dtc",
  subject,
  product: `${targetCity} pop-up`,
  seeds,
  ages,
  gender,
  goal: `Enter ${targetCity} with a pop-up, partners and creator content.`,
  targetCity,
});
const sports = (subject: string, seeds: string[], ages: A): BriefInput => ({
  family: "sports",
  subject,
  product: "US supporters' club",
  seeds,
  ages,
  goal: "Grow a US fan base and pick the first watch-party city.",
  candidateCities: METROS,
});

export const BRIEFS: BriefInput[] = [
  music("Artist M1", ["Tems", "Rema", "Asake"], CORE),
  music("Artist M2", ["Burna Boy", "Wizkid", "Davido"], MID),
  music("Artist M3", ["Ayra Starr", "Tyla"], YOUNG),
  music("Artist M4", ["SZA", "Brent Faiyaz", "Daniel Caesar"], CORE),
  music("Artist M5", ["Phoebe Bridgers", "Arctic Monkeys"], CORE),
  music("Artist M6", ["Kendrick Lamar", "Little Simz"], CORE),
  music("Artist M7", ["Morgan Wallen"], MID),
  music("Artist M8", ["Taylor Swift", "Dua Lipa"], YOUNG),
  music("Artist M9", ["Khruangbin", "Kaytranada"], MID),
  music("Artist M10", ["Omah Lay", "Lucky Daye"], CORE),
  dtc("Brand D1", ["Glossier", "Rare Beauty"], "Atlanta", CORE, "female"),
  dtc("Brand D2", ["Topicals", "Mielle Organics"], "Houston", CORE, "female"),
  dtc("Brand D3", ["Aesop", "Erewhon"], "Los Angeles", MID),
  dtc("Brand D4", ["The Ordinary", "Glossier"], "Chicago", YOUNG, "female"),
  dtc("Brand D5", ["Fenty Beauty", "Rare Beauty"], "New York", CORE, "female"),
  dtc("Brand D6", ["Telfar", "Aimé Leon Dore"], "New York", CORE),
  dtc("Brand D7", ["Kith", "Supreme"], "Los Angeles", YOUNG, "male"),
  dtc("Brand D8", ["Sweetgreen", "Erewhon"], "Seattle", MID),
  dtc("Brand D9", ["Sephora", "Ulta Beauty"], "Dallas", CORE, "female"),
  dtc("Brand D10", ["Bread Beauty Supply", "Topicals"], "Atlanta", CORE, "female"),
  sports("Club S1", ["Men in Blazers", "Ted Lasso"], MID),
  sports("Club S2", ["The Rest Is Football", "Premier League"], MID),
  sports("Club S3", ["Arsenal F.C.", "EA Sports FC"], YOUNG),
  sports("Club S4", ["Welcome to Wrexham", "Men in Blazers"], MID),
  sports("Club S5", ["Thierry Henry", "Arsenal F.C."], CORE),
  sports("Club S6", ["Micah Richards", "The Rest Is Football"], CORE),
  sports("Club S7", ["IShowSpeed", "EA Sports FC"], YOUNG),
  sports("Club S8", ["Premier League", "Heineken"], MID),
  sports("Club S9", ["Ted Lasso", "Welcome to Wrexham"], MID),
  sports("Club S10", ["Stormzy", "Arsenal F.C."], CORE),
];
