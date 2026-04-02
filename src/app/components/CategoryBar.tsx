"use client";

import { useState } from "react";

interface CategoryBarProps {
  label: string;
  icon: string;
  score: number;
  maxScore: number;
  color: string;
  delay?: number;
  /** 평가 기준 (툴팁 표시용) */
  criteriaItems?: string[];
}

export default function CategoryBar({
  label,
  icon,
  score,
  maxScore,
  color,
  delay = 0,
  criteriaItems,
}: CategoryBarProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const pct = Math.min((score / maxScore) * 100, 100);

  return (
    <div
      className="animate-fade-up"
      style={{
        animationDelay: `${delay}ms`,
        marginBottom: 12,
        position: "relative",
        zIndex: showTooltip ? 100 : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
          position: "relative",
        }}
      >
        <span
          style={{
            fontSize: 14,
            color: "#e8edf5",
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: criteriaItems ? "help" : undefined,
          }}
          onMouseEnter={() => criteriaItems && setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <span>{icon}</span>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}>{label}</span>
          {criteriaItems && (
            <span
              style={{
                fontSize: 12,
                color: "#00d4c8",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: showTooltip ? "rgba(0,212,200,0.2)" : "rgba(0,212,200,0.1)",
                border: "1px solid rgba(0,212,200,0.4)",
              }}
              title="평가 기준 보기"
            >
              ⓘ
            </span>
          )}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            fontWeight: 600,
            color,
          }}
        >
          {score}/{maxScore}
        </span>
        {showTooltip && criteriaItems && criteriaItems.length > 0 && (
          <div
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            style={{
              position: "absolute",
              left: 0,
              top: "100%",
              zIndex: 9999,
              marginTop: 2,
              padding: "10px 12px",
            background: "#1a2435",
            border: "1px solid #2d3d52",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            minWidth: 240,
            maxWidth: 320,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8b9cb3", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {label} 평가 기준
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#c4d0e0", lineHeight: 1.7 }}>
            {criteriaItems.map((item, i) => (
              <li key={`${label}-crit-${i}`}>{item}</li>
            ))}
          </ul>
        </div>
        )}
      </div>
      <div
        style={{
          height: 5,
          background: "#1e2d45",
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            borderRadius: 99,
            transition: `width 1s cubic-bezier(0.4,0,0.2,1) ${delay}ms`,
            boxShadow: `0 0 8px ${color}60`,
          }}
        />
      </div>
    </div>
  );
}
