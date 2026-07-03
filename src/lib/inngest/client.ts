import { Inngest } from "inngest";

// No event/signing key needed for local dev — `npx inngest-cli dev` auto-
// discovers this app's /api/inngest endpoint on localhost. Set
// INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY in .env to run against Inngest Cloud.
export const inngest = new Inngest({ id: "stralis-ticketing" });
