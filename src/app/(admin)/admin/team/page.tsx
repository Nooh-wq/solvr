import { redirect } from "next/navigation";

// Z3.2 — /admin/team is retired; the split lives at /admin/customers and
// /admin/team-members. Redirect old bookmarks so nothing 404s.
export default function TeamPage(): never {
  redirect("/admin/team-members");
}
