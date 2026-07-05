"use client";

import { useEffect, useState } from "react";

const TAGLINES = [
  "Support that feels effortless.",
  "Your AI copilot answers before the ticket even lands.",
  "Every conversation organized. Every customer heard.",
  "Built for teams who take support seriously.",
];

const INTERVAL_MS = 4000;

export function RotatingTaglines() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % TAGLINES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-[168px] sm:h-[152px]">
      {TAGLINES.map((tagline, i) => (
        <p
          key={tagline}
          aria-hidden={i !== index}
          className={`absolute inset-0 text-[34px] sm:text-4xl font-bold leading-tight tracking-tight text-white transition-all duration-700 ease-out ${
            i === index ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
          }`}
        >
          {tagline}
        </p>
      ))}
    </div>
  );
}
