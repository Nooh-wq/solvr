import { redirect } from "next/navigation";

// M21.1 — /profile folded into the new /account tab shell.
export default function LegacyProfileRedirect() {
  redirect("/admin/account");
}
