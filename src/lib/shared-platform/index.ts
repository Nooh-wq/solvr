// Barrel export for the shared-platform wrapper. Every consumer in this
// repo imports from "@/lib/shared-platform" — never from the sibling
// files directly, and never from "@/generated/prisma".
//
// See README.md and docs/shared-platform-boundary.md.

export * from "./context";
export * from "./types";
export * from "./errors";
export * from "./audit";
export * from "./organizations";
export * from "./end-users";
export * from "./team-members";
export * from "./groups";
export * from "./roles";
export * from "./tags";
