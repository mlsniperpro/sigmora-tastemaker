/** Identifier formats shared by the server and the browser. */
import { z } from "zod";

/** A publisher's campaign id (it appears in URLs, so the charset is tight). */
export const CampaignId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
