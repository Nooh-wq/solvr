// src/lib/service-mode/labels.ts
//
// M15.1 — terminology map for the Employee Service preset. The tenant
// stores serviceMode = "CUSTOMER" | "EMPLOYEE" on Tenant. This module
// resolves label keys to the mode-appropriate string. Pure — no DB —
// so it can be imported by client components (as `labelsFor(mode)`)
// and by RSC pages (via the same call).
//
// Spec §3 pins: the toggle is reversible + presentation-only. Nothing
// here mutates the underlying data model. Editing a ticket after the
// tenant flips to EMPLOYEE mode is still editing a Ticket row; the UI
// just labels it "Request" instead.

export type ServiceMode = "CUSTOMER" | "EMPLOYEE";

export type LabelKey =
  | "ticket"
  | "ticket_plural"
  | "ticket_new"          // "New ticket" | "New request"
  | "ticket_number"       // "Ticket #" | "Request #"
  | "customer"
  | "customer_plural"
  | "category"
  | "category_plural"
  | "portal_home_title"
  | "portal_new_cta"
  | "catalog"             // "Service catalog" — only surfaces in EMPLOYEE
  | "assets_nav";

const CUSTOMER: Record<LabelKey, string> = {
  ticket: "Ticket",
  ticket_plural: "Tickets",
  ticket_new: "New ticket",
  ticket_number: "Ticket",
  customer: "Customer",
  customer_plural: "Customers",
  category: "Category",
  category_plural: "Categories",
  portal_home_title: "Support",
  portal_new_cta: "New ticket",
  catalog: "Ticket forms",
  assets_nav: "Assets",
};

const EMPLOYEE: Record<LabelKey, string> = {
  ticket: "Request",
  ticket_plural: "Requests",
  ticket_new: "New request",
  ticket_number: "Request",
  customer: "Employee",
  customer_plural: "Employees",
  category: "Service catalog",
  category_plural: "Service catalog",
  portal_home_title: "Employee service",
  portal_new_cta: "New request",
  catalog: "Service catalog",
  assets_nav: "Assets",
};

/** Return the full label map for a mode. Callers usually destructure. */
export function labelsFor(mode: ServiceMode): Record<LabelKey, string> {
  return mode === "EMPLOYEE" ? EMPLOYEE : CUSTOMER;
}

/** Convenience: single key lookup. Defaults to CUSTOMER if the mode string is unknown. */
export function label(mode: ServiceMode | string | null | undefined, key: LabelKey): string {
  const m: ServiceMode = mode === "EMPLOYEE" ? "EMPLOYEE" : "CUSTOMER";
  return labelsFor(m)[key];
}

export function normalizeMode(raw: unknown): ServiceMode {
  return raw === "EMPLOYEE" ? "EMPLOYEE" : "CUSTOMER";
}
