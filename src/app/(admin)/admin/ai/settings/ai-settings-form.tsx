"use client";

import { useState, useTransition } from "react";
import { setAiSettings } from "@/actions/aiSettings";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function AiSettingsForm({
  initial,
}: {
  initial: {
    aiEnabled: boolean;
    aiConfidenceThreshold: number;
    aiMonthlyTokenCap: number;
    aiTokensUsedThisMonth: number;
    aiAutoTranslate: boolean;
    aiPrimaryLanguage: string;
  };
}) {
  const { toast } = useToast();
  const [aiEnabled, setEnabled] = useState(initial.aiEnabled);
  const [threshold, setThreshold] = useState(initial.aiConfidenceThreshold);
  const [cap, setCap] = useState(initial.aiMonthlyTokenCap);
  const [autoTranslate, setAutoTranslate] = useState(initial.aiAutoTranslate);
  const [lang, setLang] = useState(initial.aiPrimaryLanguage);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const r = await setAiSettings({
        aiEnabled,
        aiConfidenceThreshold: threshold,
        aiMonthlyTokenCap: cap,
        aiAutoTranslate: autoTranslate,
        aiPrimaryLanguage: lang,
      });
      if (!r.ok) {
        toast({ title: "Couldn't save", description: r.error, variant: "error" });
        return;
      }
      toast({ title: "Saved", variant: "success" });
    });
  }

  const usagePct = initial.aiMonthlyTokenCap > 0
    ? (initial.aiTokensUsedThisMonth / initial.aiMonthlyTokenCap) * 100
    : 0;

  return (
    <div className="max-w-xl space-y-4">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">Enable AI classification</h2>
            <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
              Master switch. When off, no messages get classified.
            </p>
          </div>
          <input type="checkbox" checked={aiEnabled} onChange={(e) => setEnabled(e.target.checked)} />
        </div>

        <div className="space-y-1.5 border-t border-[var(--color-neutral-200)] pt-4">
          <Label htmlFor="threshold">Confidence threshold (0–1)</Label>
          <Input id="threshold" type="number" step="0.05" min={0} max={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <p className="text-[11px] text-[var(--color-neutral-500)]">
            Signals below this render muted in the agent UI. Default 0.7.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cap">Monthly token cap</Label>
          <Input id="cap" type="number" min={0} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
          <p className="text-[11px] text-[var(--color-neutral-500)]">
            Used this month: {initial.aiTokensUsedThisMonth.toLocaleString()} tokens ({usagePct.toFixed(1)}%).
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lang">Primary language (BCP-47)</Label>
          <Input id="lang" value={lang} onChange={(e) => setLang(e.target.value)} placeholder="en" />
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-neutral-200)] pt-4">
          <div>
            <h2 className="text-[15px] font-semibold">Auto-translate</h2>
            <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
              When on, inbound messages in a different language get a translated copy stored on the message.
            </p>
          </div>
          <input type="checkbox" checked={autoTranslate} onChange={(e) => setAutoTranslate(e.target.checked)} />
        </div>

        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}
