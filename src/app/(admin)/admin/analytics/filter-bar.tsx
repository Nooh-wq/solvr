"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DropdownSelect } from "@/components/ui/dropdown-menu";

const RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const SELECT_WIDTH = "w-40";

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
 * page already uses for its one filter, just generalized to several.
 *
 * Uses the shadcn-style DropdownSelect (Radix-free custom impl) — same
 * URL-sync semantics as before, just a floating panel instead of the
 * native <select> chrome that never matched the platform look. */
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
      <DropdownSelect
        value={current.range}
        onChange={(v) => setParam("range", v)}
        options={RANGE_OPTIONS}
        ariaLabel="Date range"
        className={SELECT_WIDTH}
      />

      <DropdownSelect
        value={current.channel ?? "ALL"}
        onChange={(v) => setParam("channel", v)}
        options={[
          { value: "ALL", label: "All channels" },
          { value: "portal", label: "Portal" },
          { value: "chatbot", label: "Chatbot" },
          { value: "email", label: "Email" },
        ]}
        ariaLabel="Channel"
        className={SELECT_WIDTH}
      />

      <DropdownSelect
        value={current.categoryId ?? "ALL"}
        onChange={(v) => setParam("categoryId", v)}
        options={[
          { value: "ALL", label: "All categories" },
          ...categories.map((c) => ({ value: c.id, label: c.name })),
        ]}
        ariaLabel="Category"
        className={SELECT_WIDTH}
      />

      <DropdownSelect
        value={current.priority ?? "ALL"}
        onChange={(v) => setParam("priority", v)}
        options={[
          { value: "ALL", label: "All priorities" },
          { value: "LOW", label: "Low" },
          { value: "MEDIUM", label: "Medium" },
          { value: "HIGH", label: "High" },
          { value: "URGENT", label: "Urgent" },
        ]}
        ariaLabel="Priority"
        className={SELECT_WIDTH}
      />

      <DropdownSelect
        value={current.assignedToId ?? "ALL"}
        onChange={(v) => setParam("assignedToId", v)}
        options={[
          { value: "ALL", label: "All agents" },
          { value: "unassigned", label: "Unassigned" },
          ...agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
        ariaLabel="Assigned agent"
        className={SELECT_WIDTH}
      />

      <DropdownSelect
        value={current.organizationId ?? "ALL"}
        onChange={(v) => setParam("organizationId", v)}
        options={[
          { value: "ALL", label: "All organizations" },
          ...organizations.map((o) => ({ value: o.id, label: o.name })),
        ]}
        ariaLabel="Organization"
        className={SELECT_WIDTH}
      />

      <DropdownSelect
        value={current.groupId ?? "ALL"}
        onChange={(v) => setParam("groupId", v)}
        options={[
          { value: "ALL", label: "All groups" },
          ...groups.map((g) => ({ value: g.id, label: g.name })),
        ]}
        ariaLabel="Group"
        className={SELECT_WIDTH}
      />

      <DropdownSelect
        value={current.tag ?? "ALL"}
        onChange={(v) => setParam("tag", v)}
        options={[
          { value: "ALL", label: "All tags" },
          ...tags.map((t) => ({ value: t.name, label: t.name })),
        ]}
        ariaLabel="Tag"
        className={SELECT_WIDTH}
      />
    </div>
  );
}
