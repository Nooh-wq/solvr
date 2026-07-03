"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircleIcon, AlertCircleIcon, InfoCircleIcon, CloseIcon } from "@/components/icons";

type ToastVariant = "success" | "error" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms before auto-dismiss; 0 disables auto-dismiss. Default 4000. */
  duration?: number;
};

type ToastItem = ToastInput & { id: number };

type ToastContextValue = {
  toast: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** Global toast/alert stack — call useToast() from any client component to surface a success/error/info banner in the top-right corner. Mounted once in the root layout. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { ...input, id }]);
      const duration = input.duration ?? 4000;
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const VARIANT_STYLES: Record<ToastVariant, { icon: typeof CheckCircleIcon; iconClass: string }> = {
  success: { icon: CheckCircleIcon, iconClass: "text-green-600" },
  error: { icon: AlertCircleIcon, iconClass: "text-red-600" },
  info: { icon: InfoCircleIcon, iconClass: "text-[var(--color-primary)]" },
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { icon: Icon, iconClass } = VARIANT_STYLES[toast.variant ?? "info"];
  return (
    <div
      role="status"
      className="pointer-events-auto glass-panel rounded-2xl shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)] p-3.5 flex items-start gap-2.5 animate-[fadeIn_150ms_ease-out]"
    >
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${iconClass}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-black">{toast.title}</p>
        {toast.description && <p className="text-[12px] text-[var(--color-neutral-600)] mt-0.5">{toast.description}</p>}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-neutral-500)] hover:bg-black/[0.045] hover:text-black transition-colors duration-150 cursor-pointer"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Client-component hook for firing toasts: `const { toast } = useToast(); toast({ title: "Saved", variant: "success" })`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used within <ToastProvider>");
  return ctx;
}
