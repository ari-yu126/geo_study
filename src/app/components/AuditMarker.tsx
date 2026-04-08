"use client";

import { useState } from "react";
import type { AuditIssue } from "@/lib/analysisTypes";

const PRIORITY_COLORS: Record<string, string> = {
  high: "#f05c7a",
  medium: "#f5a623",
  low: "#34d399",
};

interface AuditMarkerProps {
  issue: AuditIssue;
  active: boolean;
  iframeScrollTop: number;
  onClick: () => void;
}

export default function AuditMarker({
  issue,
  active,
  iframeScrollTop,
  onClick,
}: AuditMarkerProps) {
  const [hovered, setHovered] = useState(false);

  if (!issue.position) return null;

  const color = PRIORITY_COLORS[issue.priority] || "#8b9cb3";
  const top = issue.position.top - iframeScrollTop;

  // 화면 밖이면 렌더링 안 함
  if (top < -40 || top > 5000) return null;

  const showTooltip = hovered || active;

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: issue.position.left + issue.position.width + 8,
        zIndex: 30 + (active ? 10 : 0),
        pointerEvents: "auto",
      }}
    >
      {/* 번호 마커 */}
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: active ? 32 : 26,
          height: active ? 32 : 26,
          borderRadius: "50%",
          background: color,
          border: `2px solid ${active ? "#fff" : "rgba(255,255,255,0.3)"}`,
          color: "#fff",
          fontSize: active ? 14 : 12,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: active
            ? `0 0 16px ${color}88, 0 2px 8px rgba(0,0,0,0.4)`
            : `0 2px 6px rgba(0,0,0,0.3)`,
          transition: "all 0.2s ease",
          fontFamily: "var(--font-mono)",
          transform: active ? "scale(1.15)" : "scale(1)",
        }}
      >
        {issue.number}
      </button>

      {/* 말풍선 툴팁 */}
      {showTooltip && (
        <div
          style={{
            position: "absolute",
            top: -4,
            left: (active ? 32 : 26) + 10,
            minWidth: 220,
            maxWidth: 280,
            background: "#0f1623",
            border: `1px solid ${color}66`,
            borderRadius: 10,
            padding: "10px 14px",
            boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 12px ${color}22`,
            zIndex: 50,
            animation: "fadeIn 0.15s ease",
          }}
        >
          {/* 말풍선 꼬리 */}
          <div
            style={{
              position: "absolute",
              left: -6,
              top: 10,
              width: 12,
              height: 12,
              background: "#0f1623",
              border: `1px solid ${color}66`,
              borderRight: "none",
              borderTop: "none",
              transform: "rotate(45deg)",
            }}
          />
          <div style={{ position: "relative" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  padding: "2px 8px",
                  borderRadius: 99,
                  background: `${color}22`,
                  border: `1px solid ${color}55`,
                  color,
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                }}
              >
                {issue.priority === "high"
                  ? "긴급"
                  : issue.priority === "medium"
                  ? "보통"
                  : "낮음"}
              </span>
            </div>
            <div
              style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e8edf5",
                marginBottom: 4,
                lineHeight: 1.3,
              }}
            >
              {issue.label}
            </div>
            <div
              style={{
              fontSize: 12,
              color: "#8b9cb3",
              lineHeight: 1.6,
              }}
            >
              {issue.description}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
