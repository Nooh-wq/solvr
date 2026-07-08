"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCsatSettings, type CsatSettingsView } from "@/actions/csatSettings";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

// M5 CSAT settings editor — enable/disable, survey type (CSAT vs
// NPS), delay hours (stored as minutes), and optional subject/body
// overrides on the email template.

export function CsatSettingsForm({ initial }: { initial: CsatSettingsView }) {
  const router = useRouter();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [surveyType, setSurveyType] = useState<"CSAT" | "NPS">(initial.surveyType);
  const [delayMinutes, setDelayMinutes] = useState<number>(initial.delayMinutes);
  const [subject, setSubject] = useState<string>(initial.emailSubject ?? "");
  const [body, setBody] = useState<string>(initial.emailBody ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    if (pending) return;
    startTransition(async () => {
      try {
        await updateCsatSettings({
          enabled,
          surveyType,
          delayMinutes,
          emailSubject: subject.trim() ? subject : null,
          emailBody: body.trim() ? body : null,
        });
        toast({ title: "CSAT settings saved", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't save",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const dirty =
    enabled !== initial.enabled ||
    surveyType !== initial.surveyType ||
    delayMinutes !== initial.delayMinutes ||
    (subject.trim() || null) !== initial.emailSubject ||
    (body.trim() || null) !== initial.emailBody;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Delivery</h2>
        <p className="text-[12px] text-[var(--color-neutral-500)] mt-0.5">
          When a ticket transitions to Resolved, a survey link is queued for
          this many minutes later. 0 sends immediately.
        </p>
      </div>

      <label className="flex items-center gap-2 text-[13px] cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>Enable surveys for this tenant</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5">Survey type</label>
          <Select
            value={surveyType}
            onChange={(e) => setSurveyType(e.target.value as "CSAT" | "NPS")}
          >
            <option value="CSAT">CSAT (1–5 stars)</option>
            <option value="NPS">NPS (0–10)</option>
          </Select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5">Delay (minutes)</label>
          <Input
            type="number"
            min={0}
            max={60 * 24 * 30}
            value={delayMinutes}
            onChange={(e) => setDelayMinutes(parseInt(e.target.value || "0", 10))}
          />
        </div>
      </div>

      <div>
        <label className="block text-[12px] font-medium mb-1.5">
          Email subject{" "}
          <span className="text-[var(--color-neutral-500)] font-normal">(optional override)</span>
        </label>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="How did we do on your ticket?"
        />
      </div>

      <div>
        <label className="block text-[12px] font-medium mb-1.5">
          Email body{" "}
          <span className="text-[var(--color-neutral-500)] font-normal">(optional override)</span>
        </label>
        <Textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="We'd love to know how it went — it only takes a few seconds."
        />
      </div>

      <Button variant="primary" onClick={save} disabled={pending || !dirty}>
        {pending ? "Saving…" : dirty ? "Save settings" : "Saved"}
      </Button>
    </div>
  );
}
