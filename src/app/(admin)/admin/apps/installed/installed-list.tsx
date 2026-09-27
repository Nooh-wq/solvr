"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  testIntegration,
  uninstallIntegration,
  type InstalledIntegrationDto,
} from "@/actions/marketplace";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function InstalledList({ installs }: { installs: InstalledIntegrationDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function runTest(id: string) {
    startTransition(async () => {
      try {
        const res = await testIntegration(id);
        toast({
          title: res.ok ? "Test passed" : "Test failed",
          description: res.message ?? undefined,
          variant: res.ok ? "success" : "error",
        });
        router.refresh();
      } catch (e) {
        toast({
          title: "Test errored",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function uninstall(id: string, name: string) {
    if (!confirm(`Uninstall ${name}? This is reversible only by reinstalling with fresh credentials.`)) return;
    startTransition(async () => {
      try {
        await uninstallIntegration(id);
        toast({ title: `Uninstalled ${name}`, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't uninstall",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  if (installs.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        No integrations installed yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {installs.map((i) => (
        <div
          key={i.id}
          className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-[15px] font-semibold">
                {i.appName} · <span className="text-[var(--color-neutral-600)]">{i.displayName}</span>
              </div>
              <div className="text-[11px] uppercase-label text-[var(--color-neutral-500)] mt-1">
                {i.isActive ? "Active" : "Disabled"} ·{" "}
                {i.lastTestedAt ? (
                  <>
                    Last test:{" "}
                    {i.lastTestOk ? (
                      <span className="text-emerald-700">OK</span>
                    ) : (
                      <span className="text-red-600">FAIL</span>
                    )}{" "}
                    · {new Date(i.lastTestedAt).toLocaleString()}
                  </>
                ) : (
                  "Not tested"
                )}
              </div>
              {i.lastTestOk === false && i.lastTestMessage ? (
                <div className="text-[12px] text-red-600 mt-1">{i.lastTestMessage}</div>
              ) : null}
            </div>
          </div>
          {Object.keys(i.metaJson).length > 0 ? (
            <div className="text-[12px] text-[var(--color-neutral-700)] mb-3">
              {Object.entries(i.metaJson)
                .filter(([, v]) => v !== "" && v != null)
                .map(([k, v]) => (
                  <div key={k}>
                    <span className="text-[var(--color-neutral-500)]">{k}:</span> {String(v)}
                  </div>
                ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => runTest(i.id)}>
              Test
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => uninstall(i.id, `${i.appName}: ${i.displayName}`)}
            >
              Uninstall
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
