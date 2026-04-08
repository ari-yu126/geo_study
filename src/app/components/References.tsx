"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

export default function References() {
  const [sources, setSources] = useState<Array<{ title?: string; url?: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/geo-config/update");
        if (!res.ok) return;
        const data = await res.json();
        const cfg = data?.config as { source_summary?: string[] } | undefined;
        const src = cfg?.source_summary ?? null;
        if (!mounted) return;
        if (Array.isArray(src)) {
          const parsed = src.map((s: string) => {
            const line = String(s).trim();
            const m = line.match(/(https?:\/\/[^\s<]+[^\s<.,;)]?)/);
            const url = m ? m[1] ?? m[0] : undefined;
            return { title: line.replace(url ?? "", "").replace(/[—\-–]\s*$/, "").trim() || line, url };
          });
          setSources(parsed);
        } else {
          setSources([]);
        }
      } catch {
        if (mounted) setSources([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div style={{ color: "#7a8da3", fontSize: 13 }}>참고 출처 불러오는 중…</div>;
  if (!sources || sources.length === 0)
    return <div style={{ color: "#7a8da3", fontSize: 13 }}>월간 GEO 설정에 요약된 참고 출처가 없습니다.</div>;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {sources.map((s, i) => (
        <div key={i} style={{ background: "#0f1623", border: "1px solid #1e2d45", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div style={{ fontSize: 13, color: "#e8edf5", fontWeight: 600, lineHeight: 1.45 }}>{s.title ?? "Reference"}</div>
            {s.url && (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: "#00d4c8", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
              >
                <ExternalLink size={14} />
                열기
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
