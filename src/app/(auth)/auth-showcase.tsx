import type { SVGProps } from "react";
import { SparklesIcon, CheckCircleIcon, TicketIcon, ChatIcon } from "@/components/icons";
import { RotatingTaglines } from "./rotating-taglines";

function FloatingCard({
  icon: Icon,
  stat,
  label,
  className,
  delay = "0s",
}: {
  icon: (props: SVGProps<SVGSVGElement>) => React.ReactElement;
  stat: string;
  label: string;
  className: string;
  delay?: string;
}) {
  return (
    <div
      className={`absolute z-20 hidden xl:flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 backdrop-blur-xl px-4 py-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.55)] animate-[float_6s_ease-in-out_infinite] ${className}`}
      style={{ animationDelay: delay }}
    >
      <span className="h-9 w-9 shrink-0 rounded-xl bg-[var(--color-primary)] flex items-center justify-center text-white">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-bold text-white leading-tight whitespace-nowrap">{stat}</p>
        <p className="text-[11px] text-white/60 leading-tight whitespace-nowrap">{label}</p>
      </div>
    </div>
  );
}

/** Right-hand marketing panel on the auth screen: rotating taglines with
 * floating glassmorphic stat cards slightly overlapping the text. Desktop
 * (lg+) only — see AuthLayout. */
export function AuthShowcase() {
  return (
    <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden auth-showcase-bg items-center justify-center">
      <div className="relative w-full max-w-lg px-12 xl:px-16 py-28">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-[12px] font-medium text-white/70 backdrop-blur-md mb-6">
            <SparklesIcon className="h-3.5 w-3.5" />
            Powered by AI copilot
          </div>
          <RotatingTaglines />
          <p className="text-white/55 text-[15px] max-w-sm mt-3">
            Give your customers a support experience worth talking about — and give your team the tools to deliver it.
          </p>
        </div>

        <FloatingCard
          icon={SparklesIcon}
          stat="AI Copilot"
          label="Drafts replies in seconds"
          className="top-[-2.5rem] right-[-2.5rem]"
        />
        <FloatingCard
          icon={CheckCircleIcon}
          stat="98% CSAT"
          label="Customer satisfaction"
          className="bottom-[-2.5rem] left-[-3rem]"
          delay="1.5s"
        />
        <FloatingCard
          icon={TicketIcon}
          stat="12,000+"
          label="Tickets resolved monthly"
          className="bottom-[-4rem] right-[1rem]"
          delay="3s"
        />
        <FloatingCard
          icon={ChatIcon}
          stat="Real-time"
          label="Team & customer chat"
          className="top-[-2rem] left-[-2rem]"
          delay="0.75s"
        />
      </div>
    </div>
  );
}
