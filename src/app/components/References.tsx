 "use client";

import { useEffect, useState } from "react";

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
        // Try config.source_summary first (array of strings), otherwise no-op
        const src = data?.source_summary ?? data?.config?.source_summary ?? null;
        if (!mounted) return;
        if (Array.isArray(src)) {
          // Normalize strings into objects with title/url if possible
          const parsed = src.map((s: string) => {
            return { title: String(s), url: String(s) };
          });
          setSources(parsed);
        } else {
          setSources([]);
        }
      } catch {
        // silent
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div style={{ color: "#7a8da3", fontSize: 13 }}>Loading references...</div>;
  if (!sources || sources.length === 0) return <div style={{ color: "#7a8da3", fontSize: 13 }}>No reference sources available.</div>;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {sources.map((s, i) => (
        <div key={i} style={{ background: "#0f1623", border: "1px solid #1e2d45", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 13, color: "#e8edf5", fontWeight: 700 }}>{s.title ?? s.url}</div>
            {s.url && (
              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#00d4c8" }}>
                Source
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

