"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateSurveyResponse } from "@/actions/csatSettings";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Status = "VISIBLE" | "FLAGGED" | "HIDDEN";

// M5.3 — inline action buttons for a single survey response row.
// Flag = keep visible but mark for follow-up (yellow chip). Hide =
// stop rendering the comment in every non-admin surface.

export function ModerationActions({
  surveyResponseId,
  initialStatus,
}: {
  surveyResponseId: string;
  initialStatus: Status;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [pending, startTransition] = useTransition();

  function apply(next: Status) {
    if (next === status || pending) return;
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      try {
        await moderateSurveyResponse({ surveyResponseId, status: next });
        toast({ title: `Marked ${next.toLowerCase()}`, variant: "success" });
        router.refresh();
      } catch (e) {
        setStatus(prev);
        toast({
          title: "Couldn't update",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="flex gap-1">
      <Button
        variant={status === "VISIBLE" ? "primary" : "ghost"}
        onClick={() => apply("VISIBLE")}
        disabled={pending}
        className="text-[11px] px-2 py-0.5"
      >
        Visible
      </Button>
      <Button
        variant={status === "FLAGGED" ? "primary" : "ghost"}
        onClick={() => apply("FLAGGED")}
        disabled={pending}
        className="text-[11px] px-2 py-0.5"
      >
        Flag
      </Button>
      <Button
        variant={status === "HIDDEN" ? "danger" : "ghost"}
        onClick={() => apply("HIDDEN")}
        disabled={pending}
        className="text-[11px] px-2 py-0.5"
      >
        Hide
      </Button>
    </div>
  );
}
