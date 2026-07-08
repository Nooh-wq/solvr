"use client";

import { useState, useTransition } from "react";
import { submitCsatRating } from "@/actions/csat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StarIcon } from "@/components/icons";

// M5.4 — dual-scale rating form. CSAT renders 1..5 stars, NPS renders
// 0..10 numeric buttons. Both submit through the same server action,
// which enforces the range per surveyType.

export function RatingForm({
  token,
  existingRating,
  surveyType,
}: {
  token: string;
  existingRating: number | null;
  surveyType: "CSAT" | "NPS";
}) {
  const [rating, setRating] = useState(existingRating ?? -1);
  const [hovered, setHovered] = useState(-1);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(existingRating !== null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isNps = surveyType === "NPS";
  const min = isNps ? 0 : 1;
  const max = isNps ? 10 : 5;

  function submit() {
    if (rating < min) {
      setError("Pick a rating first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitCsatRating({
        token,
        rating,
        comment: comment.trim() || undefined,
        surveyType,
      });
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
        {isNps ? (
          <div className="text-3xl font-semibold mb-2 text-[var(--color-primary)]">
            {rating}
            <span className="text-[var(--color-neutral-500)] text-lg"> / 10</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <StarIcon
                key={n}
                className={`h-6 w-6 ${
                  n <= rating ? "text-[var(--color-primary)]" : "text-[var(--color-neutral-300)]"
                }`}
              />
            ))}
          </div>
        )}
        <p className="text-[14px] font-semibold mb-1">Thanks for the feedback!</p>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          You can update your rating any time by revisiting this link.
        </p>
      </div>
    );
  }

  return (
    <div>
      {isNps ? (
        <div className="mb-5">
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-2 text-center">
            How likely are you to recommend us?
          </p>
          <div className="grid grid-cols-11 gap-1">
            {Array.from({ length: 11 }, (_, i) => i).map((n) => {
              const active = n === rating;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`Score ${n}`}
                  className={`h-9 rounded-md text-[13px] font-medium border transition-colors cursor-pointer ${
                    active
                      ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                      : "bg-[var(--color-surface)] border-[var(--color-neutral-300)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-[var(--color-neutral-500)] mt-1 px-0.5">
            <span>Not likely</span>
            <span>Very likely</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-1.5 mb-5" onMouseLeave={() => setHovered(-1)}>
          {[1, 2, 3, 4, 5].map((n) => {
            const activeIdx = hovered >= 0 ? hovered : rating;
            const active = n <= activeIdx;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                onMouseEnter={() => setHovered(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                className="cursor-pointer transition-transform duration-100 hover:scale-110"
              >
                <StarIcon
                  className={`h-9 w-9 ${
                    active ? "text-[var(--color-primary)]" : "text-[var(--color-neutral-300)]"
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}

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
