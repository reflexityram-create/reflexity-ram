/**
 * Reflexity brand mark — two interlocking rings.
 * Two circles (centre-line radius 46.5, stroke 10, centres 55 apart), each a
 * ~296° arc. One end of each ring curls into the overlap (the swirl in the
 * middle); the other stops just before a crossing so that ring dips under the
 * other one there. The ends used to stop just past the crossings, which left
 * bumps on the other ring, most visible in dark mode.
 */
export default function ReflexityMark({ size = 28, color = "#FFCF24", className = "" }) {
  const ratio = 160 / 104;
  return (
    <svg
      width={size * ratio}
      height={size}
      viewBox="0 0 160 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      data-testid="reflexity-mark"
      aria-hidden="true"
    >
      <g fill="none" stroke={color} strokeWidth="10" strokeLinecap="round">
        <path d="M 98.05 45.03 A 46.5 46.5 0 1 1 66.41 7.29" />
        <path d="M 60.95 57.97 A 46.5 46.5 0 1 1 92.59 95.71" />
      </g>
    </svg>
  );
}
