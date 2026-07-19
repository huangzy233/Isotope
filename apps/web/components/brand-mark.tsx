import { cn } from "@/lib/utils";

/** Three interlocking hexagons — Isotope brand mark. */
export function BrandMark({
  className,
  title = "Isotope",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-primary", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {/* Top hexagon */}
      <path
        d="M24 3.5 36.5 10.7v14.4L24 32.3 11.5 25.1V10.7L24 3.5Z"
        stroke="currentColor"
        strokeWidth="3.75"
        strokeLinejoin="round"
      />
      {/* Bottom-left hexagon */}
      <path
        d="M14.2 15.8 26.7 23v14.4L14.2 44.6 1.7 37.4V23l12.5-7.2Z"
        stroke="currentColor"
        strokeWidth="3.75"
        strokeLinejoin="round"
      />
      {/* Bottom-right hexagon */}
      <path
        d="M33.8 15.8 46.3 23v14.4L33.8 44.6 21.3 37.4V23l12.5-7.2Z"
        stroke="currentColor"
        strokeWidth="3.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}
