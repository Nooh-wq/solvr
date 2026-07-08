"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertAgentProfile } from "@/actions/routing";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

// M3.1 — AgentProfile editor for a team member's detail page. Surfaces
// the three routing-relevant knobs: skills (chips), maxOpen (capacity),
// and availability (agent-controlled elsewhere too, mirrored here so
// admins can override).

export function AgentProfileEditor({
  teamMemberId,
  initialSkills,
  initialMaxOpen,
  initialIsAvailable,
  disabled,
}: {
  teamMemberId: string;
  initialSkills: string[];
  initialMaxOpen: number;
  initialIsAvailable: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [skills, setSkills] = useState<string[]>(initialSkills);
  const [maxOpen, setMaxOpen] = useState<number>(initialMaxOpen);
  const [isAvailable, setIsAvailable] = useState<boolean>(initialIsAvailable);
  const [draft, setDraft] = useState<string>("");
  const [pending, startTransition] = useTransition();

  function addSkill() {
    const s = draft.trim().toLowerCase();
    if (!s) return;
    if (skills.includes(s)) {
      setDraft("");
      return;
    }
    setSkills([...skills, s]);
    setDraft("");
  }

  function removeSkill(s: string) {
    setSkills(skills.filter((x) => x !== s));
  }

  function save() {
    if (pending) return;
    startTransition(async () => {
      try {
        await upsertAgentProfile({
          teamMemberId,
          skills,
          maxOpen,
          isAvailable,
        });
        toast({ title: "Agent profile saved", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't save profile",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const dirty =
    JSON.stringify(skills) !== JSON.stringify(initialSkills) ||
    maxOpen !== initialMaxOpen ||
    isAvailable !== initialIsAvailable;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <h3 className="text-sm font-semibold mb-1">Agent profile</h3>
      <p className="text-[12px] text-[var(--color-neutral-500)] mb-4">
        Powers the routing engine. Skills gate skills-based picks;
        capacity caps load-based; availability excludes from every strategy.
      </p>

      {/* Skills */}
      <div className="mb-4">
        <label className="block text-[12px] font-medium mb-1.5">Skills</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {skills.length === 0 ? (
            <span className="text-[12px] text-[var(--color-neutral-500)] italic">
              No skills — this agent won't match skills-based rules.
            </span>
          ) : (
            skills.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-neutral-300)] bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px]"
              >
                {s}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeSkill(s)}
                    className="text-[var(--color-neutral-500)] hover:text-red-600 cursor-pointer"
                    aria-label={`Remove skill ${s}`}
                  >
                    ×
                  </button>
                )}
              </span>
            ))
          )}
        </div>
        {!disabled && (
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
              }}
              placeholder="e.g. billing, spanish"
              className="text-[13px]"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={addSkill}
              disabled={!draft.trim()}
            >
              Add
            </Button>
          </div>
        )}
      </div>

      {/* maxOpen */}
      <div className="mb-4">
        <label className="block text-[12px] font-medium mb-1.5">
          Max open tickets{" "}
          <span className="text-[var(--color-neutral-500)] font-normal">
            (0 = unlimited)
          </span>
        </label>
        <Input
          type="number"
          min={0}
          max={500}
          value={maxOpen}
          onChange={(e) => setMaxOpen(parseInt(e.target.value || "0", 10))}
          disabled={disabled}
          className="text-[13px] w-32"
        />
      </div>

      {/* Availability */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
          <input
            type="checkbox"
            checked={isAvailable}
            onChange={(e) => setIsAvailable(e.target.checked)}
            disabled={disabled}
          />
          <span>Available for routing</span>
        </label>
        <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">
          Agents can also toggle this themselves from the workspace header.
        </p>
      </div>

      <Button
        variant="primary"
        onClick={save}
        disabled={disabled || pending || !dirty}
      >
        {pending ? "Saving…" : dirty ? "Save profile" : "Saved"}
      </Button>
    </div>
  );
}
