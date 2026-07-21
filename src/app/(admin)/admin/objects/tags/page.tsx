import { listTagsWithUsage } from "@/actions/adminTags";
import { TagsEditor } from "./tags-editor";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const tags = await listTagsWithUsage();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Tags</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Reusable labels you can attach to tickets, customers, team members, and organizations.
      </p>
      <TagsEditor initialTags={tags} />
    </div>
  );
}
