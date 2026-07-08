import { listCannedResponses } from "@/actions/cannedResponses";
import { requireSession } from "@/lib/auth";
import { roleAtLeast } from "@/lib/auth";
import { CannedResponsesEditor } from "./editor";

export default async function CannedResponsesPage() {
  const [session, responses] = await Promise.all([
    requireSession({ minRole: "AGENT" }),
    listCannedResponses(),
  ]);
  const canShare = roleAtLeast(session.role, "ADMIN");
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Canned responses</h1>
      <p className="text-[13px] text-[var(--color-neutral-500)] mb-6">
        Reusable reply snippets. Type <code className="bg-[var(--color-neutral-100)] dark:bg-white/[0.06] px-1 rounded">/shortcut</code> in the ticket composer to insert. Personal responses are visible only to you; shared responses are available to the whole team.
      </p>
      <CannedResponsesEditor
        initialRows={responses.map((r) => ({
          id: r.id,
          name: r.name,
          shortcut: r.shortcut,
          body: r.body,
          isShared: r.isShared,
          isOwned: r.ownerTeamMemberId === session.subjectId,
        }))}
        canShare={canShare}
        actingSubjectId={session.subjectId}
      />
    </div>
  );
}
