import Link from "next/link";

type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
  subtitle?: string;
};

export function BrandMark({
  compact = false,
  inverse = false,
  subtitle = "Talent intelligence platform",
}: BrandMarkProps) {
  return (
    <Link className="brand-lockup group" href="/" aria-label="AI Talent home">
      <span className="brand-symbol" aria-hidden="true">
        <svg viewBox="0 0 42 42" role="img">
          <path d="M11 12.5 21 6l10 6.5v17L21 36l-10-6.5v-17Z" />
          <path d="m15.5 23.5 4-9h3l4 9M17 20.5h8M29.5 14v10" />
        </svg>
      </span>
      {!compact && (
        <span>
          <strong className={inverse ? "text-white" : "text-[#091426]"}>
            AI <em>Talent</em>
          </strong>
          <small className={inverse ? "text-white/55" : "text-slate-500"}>
            {subtitle}
          </small>
        </span>
      )}
    </Link>
  );
}

export function ArrowIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
      <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M12 3.5c.65 4.6 2.9 6.85 7.5 7.5-4.6.65-6.85 2.9-7.5 7.5-.65-4.6-2.9-6.85-7.5-7.5 4.6-.65 6.85-2.9 7.5-7.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}
