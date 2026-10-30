/** Identifier formats shared by the server and the browser. */
import { z } from "zod";
import { CAMPAIGN_ID_RE } from "./vocab";

/** A publisher's campaign id (it appears in URLs, so the charset is tight). */
export const CampaignId = z.string().regex(CAMPAIGN_ID_RE);
