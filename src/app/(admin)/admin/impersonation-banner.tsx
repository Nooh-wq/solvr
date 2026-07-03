"use client";

import { useTransition } from "react";
import { stopImpersonation } from "@/actions/super";
import { Button } from "@/components/ui/button";

export function ImpersonationBanner({ tenantName }: { tenantName: string }) {
  const [pending, startTransition] = useTransition();

  function stop() {
    startTransition(async () => {
      await stopImpersonation();
    });
  }

  return (
    <div className="h-9 bg-black/90 backdrop-blur-xl text-white px-6 flex items-center justify-between text-[13px] relative z-40">
      <span>
        Viewing as <strong>{tenantName}</strong> — every action here is audit-logged against this tenant.
      </span>
      <Button
        variant="secondary"
        size="sm"
        className="h-6 px-3 border-white/40 text-white hover:bg-white/10 hover:-translate-y-0"
        onClick={stop}
        disabled={pending}
      >
        {pending ? "Stopping…" : "Stop impersonating"}
      </Button>
    </div>
  );
}
