"use client";

import { useState, useTransition } from "react";
import { submitCsatRating } from "@/actions/csat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StarIcon } from "@/components/icons";

export function RatingForm({ token, existingRating }: { token: string; existingRating: number | null }) {
  const [rating, setRating] = useState(existingRating ?? 0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(existingRating !== null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (rating === 0) {
      setError("Pick a rating first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitCsatRating({ token, rating, comment: comment.trim() || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="text-center py-2">
        <div className="flex items-center justify-center gap-1 mb-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <StarIcon
              key={n}
              className={`h-6 w-6 ${n <= rating ? "text-[var(--color-primary)]" : "text-[var(--color-neutral-300)]"}`}
            />
          ))}
        </div>
        <p className="text-[14px] font-semibold mb-1">Thanks for the feedback!</p>
        <p className="text-[13px] text-[var(--color-neutral-600)]">You can update your rating any time by revisiting this link.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-center gap-1.5 mb-5" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n <= (hovered || rating);
          return (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHovered(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className="cursor-pointer transition-transform duration-100 hover:scale-110"
            >
              <StarIcon className={`h-9 w-9 ${active ? "text-[var(--color-primary)]" : "text-[var(--color-neutral-300)]"}`} />
            </button>
          );
        })}
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Anything you'd like to add? (optional)"
        rows={3}
        className="mb-4"
      />
      {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}
      <Button className="w-full" onClick={submit} disabled={pending}>
        {pending ? "Submitting…" : "Submit rating"}
      </Button>
    </div>
  );
}
