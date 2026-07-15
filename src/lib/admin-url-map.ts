// M-admin — legacy → canonical URL redirect map.
//
// Spec §"URL redirects for existing bookmarks": keep every old admin
// URL working via a 302. We list only the moves — pages whose
// canonical URL didn't change (e.g. /admin/branding still lives at
// /admin/branding) get no entry.
//
// Consumed by next.config.ts's async redirects(). All redirects are
// permanent: false so an admin can reverse-migrate cheaply if needed
// (spec §"keep redirects live indefinitely" is about not deleting the
// map — 302 vs 301 is a separate call).

export type AdminUrlRedirect = { source: string; destination: string; permanent: false };

export const ADMIN_URL_REDIRECTS: AdminUrlRedirect[] = [
  // Analytics section relocations — the section is new; old top-nav
  // URLs (which stayed put) don't need redirects. Only Audit Log
  // logically moves from Account → Analytics section — kept at its
  // existing URL because the sidebar's Audit-Log link already points
  // there. (No source→destination for /admin/audit-log — canonical
  // stays.)

  // Compliance moved from a phase-M20 nested path to the canonical
  // Data & Privacy label; keep the old link working for admins who
  // bookmarked it.
  // (Currently identical — no rewrite needed; entry kept as a template.)
];
