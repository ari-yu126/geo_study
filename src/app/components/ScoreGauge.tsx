"use client";

import { getGeoGradeInfo } from "../utils/geoReportLabels";

interface ScoreGaugeProps {
  score: number;
  size?: number;
  strokeWidth?: number;
}

/** Web CSS hex — canonical tiers live in `getGeoGradeInfo` (geoReportLabels) */
function getGradeInfo(score: number) {
  const g = getGeoGradeInfo(score);
  return {
    grade: g.grade,
    label: g.label,
    color: `#${g.colorHex}`.toLowerCase(),
  };
}

export default function ScoreGauge({
  score,
  size = 140,
  strokeWidth = 9,
}: ScoreGaugeProps) {
  const gi = getGradeInfo(score);
  const r = (size - strokeWidth * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#1e2d45"
          strokeWidth={strokeWidth}
        />
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={gi.color}
          strokeWidth={strokeWidth}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          filter="url(#glow)"
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "50% 50%",
            transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)",
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: size * 0.27,
            fontWeight: 800,
            color: gi.color,
            lineHeight: 1,
          }}
        >
          {gi.grade}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: size * 0.15,
            color: "#8b9cb3",
          }}
        >
          {score}점
        </span>
      </div>
    </div>
  );
}

export { getGradeInfo };
