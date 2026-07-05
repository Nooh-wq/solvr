import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { REDIRECT_BY_ROLE } from "@/lib/redirect-by-role";

// "/" itself has no UI of its own — a signed-in visitor lands on their role's
// dashboard, and everyone else lands straight on the split-screen login
// (see (auth)/layout.tsx), so that's the actual first screen the app shows
// instead of a marketing splash the visitor had to click through.
export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? REDIRECT_BY_ROLE[user.role] : "/auth/login");
}
