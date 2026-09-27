"use client";

import { useState, useTransition } from "react";
import { updateLocalization } from "@/actions/accountSettings";

const COMMON_LOCALES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "nl-NL", label: "Dutch" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ar-SA", label: "Arabic" },
];

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function LocalizationEditor({
  initialLocale,
  initialTimezone,
}: {
  initialLocale: string;
  initialTimezone: string;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const preview = (() => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone,
      }).format(new Date());
    } catch {
      return "(invalid locale/timezone)";
    }
  })();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const res = await updateLocalization({ locale, timezone });
      setMessage(res.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: res.error });
    });
  }

  return (
    <form
      onSubmit={submit}
      className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl max-w-3xl space-y-4"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
            Default language
          </label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
          >
            {COMMON_LOCALES.some((l) => l.code === locale) ? null : (
              <option value={locale}>{locale} (custom)</option>
            )}
            {COMMON_LOCALES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
            Default timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
          >
            {COMMON_TIMEZONES.includes(timezone) ? null : (
              <option value={timezone}>{timezone} (custom)</option>
            )}
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-[var(--color-neutral-100)] text-[12px]">
        <div className="text-[10px] uppercase-label text-[var(--color-neutral-500)] mb-1">Preview</div>
        <div className="font-mono">{preview}</div>
      </div>

      {message ? (
        <div
          className={`text-[13px] ${
            message.kind === "ok" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
        >
          Save changes
        </button>
      </div>
    </form>
  );
}
