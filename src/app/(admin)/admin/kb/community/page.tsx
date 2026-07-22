import { listPendingModeration } from "@/actions/community";
import { ModerationQueue } from "./moderation-queue";

export default async function CommunityModerationPage() {
  const { posts, replies } = await listPendingModeration();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Community moderation</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        New community posts and replies land here for review when the help center has moderation on.
      </p>
      <ModerationQueue posts={posts} replies={replies} />
    </div>
  );
}
