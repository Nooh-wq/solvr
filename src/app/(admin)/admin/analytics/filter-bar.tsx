"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

const RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const SELECT_WIDTH = "h-9 w-40";

type Filter = {
  range: string;
  channel?: string;
  categoryId?: string;
  priority?: string;
  assignedToId?: string;
  organizationId?: string;
  groupId?: string;
  tag?: string;
};

/** Drives the analytics page's filters entirely via the URL — every change
 * pushes a new query string, causing the server component (page.tsx) to
 * re-render with new searchParams and re-fetch, same pattern the audit-log
 * page already uses for its one filter, just generalized to several. */
export function FilterBar({
  current,
  categories,
  agents,
  organizations,
  groups,
  tags,
}: {
  current: Filter;
  categories: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  tags: { name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "ALL") params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <Select
        value={current.range}
        onChange={(e) => setParam("range", e.target.value)}
        className={SELECT_WIDTH}
        aria-label="Date range"
      >
        {RANGE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      <Select
        value={current.channel ?? "ALL"}
        onChange={(e) => setParam("channel", e.target.value)}
        className={SELECT_WIDTH}
        aria-label="Channel"
      >
        <option value="ALL">All channels</option>
        <option value="portal">Portal</option>
        <option value="chatbot">Chatbot</option>
        <option value="email">Email</option>
      </Select>

      <Select
        value={current.categoryId ?? "ALL"}
        onChange={(e) => setParam("categoryId", e.target.value)}
        className={SELECT_WIDTH}
        aria-label="Category"
      >
        <option value="ALL">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      <Select
        value={current.priority ?? "ALL"}
        onChange={(e) => setParam("priority", e.target.value)}
        className={SELECT_WIDTH}
        aria-label="Priority"
      >
        <option value="ALL">All priorities</option>
        <option value="LOW">Low</option>
        <option value="MEDIUM">Medium</option>
        <option value="HIGH">High</option>
        <option value="URGENT">Urgent</option>
      </Select>

      <Select
        value={current.assignedToId ?? "ALL"}
        onChange={(e) => setParam("assignedToId", e.target.value)}
        className={SELECT_WIDTH}
        aria-label="Assigned agent"
      >
        <option value="ALL">All agents</option>
        <option value="unassigned">Unassigned</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>

      <Select
        value={current.organizationId ?? "ALL"}
        onChange={(e) => setParam("organizationId", e.target.value)}
        className={SELECT_WIDTH}
        aria-label="Organization"
      >
        <option value="ALL">All organizations</option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>

      <Select
        value={current.groupId ?? "ALL"}
        onChange={(e) => setParam("groupId", e.target.value)}
        className={SELECT_WIDTH}
        aria-label="Group"
      >
        <option value="ALL">All groups</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>

      <Select
        value={current.tag ?? "ALL"}
        onChange={(e) => setParam("tag", e.target.value)}
        className={SELECT_WIDTH}
        aria-label="Tag"
      >
        <option value="ALL">All tags</option>
        {tags.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
