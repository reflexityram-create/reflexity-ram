/**
 * Reflexity brand mark — two interlocking rings.
 * Two circles (centre-line radius 46.5, stroke 10, centres 55 apart), each
 * drawn as a ~324° arc whose gap is centred on the crossing where it passes
 * under the other ring: the left ring dips under at the bottom, the right ring
 * at the top. (The geometry first recovered from the reflexity.io favicon had
 * its gaps away from the crossings, so the ring ends poked into the overlap.)
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
        <path d="M 66.41 95.71 A 46.5 46.5 0 1 1 89.84 78.53" />
        <path d="M 92.59 7.29 A 46.5 46.5 0 1 1 69.16 24.47" />
      </g>
    </svg>
  );
}
