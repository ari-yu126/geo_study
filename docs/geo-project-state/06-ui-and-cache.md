# 06 — UI and Cache

## UI Flow
1. User inputs URL and triggers analysis  
2. Request sent to `/api/analyze`  
3. Loading state displayed while pipeline runs  
4. Response received (`AnalysisResult`)  
5. UI renders:
   - **Left panel (AuditPanel):** headline GEO score and per-axis-style breakdown first; then the main analysis blocks in this order: **discovered issues → question coverage → strengths (“what already works”) → content improvement guide** (deterministic recommendations from the recommendation engine; optional AI writing examples only when the user triggers them). Other blocks (e.g. platform constraints, improvement opportunities when no rule-based guide exists, golden paragraphs) may appear after those.  
   - **Right panel:** page preview (see **Preview vs analysis** below) with optional overlay markers when a live iframe is used  

**Why this order:** the panel is organized as **problem → evidence → balance → resolution**—surfacing gaps and question fit before strengths, then actionable guidance—so improvement priorities are easier to follow than a strengths-first layout.

## URL identity vs display (API & UI)

- **`normalizedUrl`** — canonical key for Supabase `analysis_history`, in-memory cache, and dedupe. Produced by `normalizeUrl` (e.g. product-detail identity query params preserved; leading `www` stripped for stability).
- **`finalFetchedUrl` / `analysisFetchTargetUrl`** — optional fields on `AnalysisResult` describing the actual HTTP fetch (after redirects, or a preferred host such as `www` when the identity URL is apex). Server-side fetch uses `resolveFetchTargetUrl` so network behavior and cache keys stay distinct.
- **`url` (display / open-in-browser)** — user-facing string: prefer post-redirect fetch URL, else fetch target, else sanitized input — **not** “normalized-only” in the panel or address bar when they differ from the live page.

The **analyze pipeline** runs on the server against fetched HTML; it does **not** depend on the client preview mode.

## Preview vs analysis (right panel)

- **Live preview** loads the target through `/api/proxy` (same-origin to the app) when policy allows, so injected scripts can support golden highlights.
- **When the proxy cannot return HTML** (e.g. upstream redirect loop, network failure), the UI does **not** load the raw `https://…` URL in the iframe by default — that often yields a **blank frame** (`X-Frame-Options` / CSP). Instead it shows the same **static summary card** as other fallbacks (user-facing copy explains “load restriction”; internal debug copy in `StaticSitePreviewCard` when `debug` is enabled — see below).
- **Some commerce SPAs** break inside an embedded context (third-party storage, wrong origin expectations, client bootstrap errors). Mitigations:
  1. **Host policy** (`src/lib/previewPolicy.ts`) — `LIVE_PREVIEW_BLOCKED_HOSTS`: apex hosts that **always** skip live iframe and show a **static summary card** plus **open original in new tab**. Matching uses the hostname from `result.url` / `normalizedUrl` and does **not** depend on `pageType === 'commerce'` so a misclassified editorial URL on a known host still avoids a white iframe flash.
  2. **Runtime fallback** (`src/lib/previewRuntimeFallback.ts` + iframe `error` / `unhandledrejection` listeners on the **nested `Window` of the same-origin `/api/proxy` document only**) — repeated or high-confidence errors switch to the same static card. Direct external URLs and embeds are not instrumented (cross-origin `contentWindow` access is avoided).
- **Cross-origin iframe** (direct `https://…` in the iframe without a readable `contentWindow`) cannot be instrumented; host policy and proxy-vs-static rules still matter there.

**Static preview debug copy:** `src/app/components/StaticSitePreviewCard.tsx` separates short **user** copy from longer **debug** reason text. With query `?debug=1` or `?debug=true`, the card shows the debug explanation (and a “· 디버그” label).

Analysis results and caching are unchanged when preview is static-only.

**Final score:** the displayed headline score may apply a **small capped post-blend adjustment** from discovered issue severities (see `preIssuePenaltyFinalScore` / `issuePenaltyPoints` on `scores` in API payloads) so the number stays consistent with the issue list; axis scores and blend math in the engine are unchanged.

## Cache Strategy
Before running analysis:

- derive **normalized URL** from the sanitized request body (server-side) for lookup keys  
- check `analysis_history` for recent result  

If cached result exists (within 24h):
- return cached result  
- skip analysis pipeline and Gemini calls  

If not:
- run full analysis  
- store result in Supabase  

## Cache Conditions

Cache is stored only when:

- analysis is complete (not limitedAnalysis)
- sufficient HTML content is available
- result includes valid scoring signals (e.g., answerabilityScore)

Incomplete or limited analyses are not cached.

## Persistence
After analysis completes:

- result is upserted into `analysis_history`
- includes:
  - normalized_url
  - geo_score
  - question_coverage
  - full result_json

## Operational notes
- Supabase connectivity: the pipeline checks `isSupabaseReachable()` before attempting cache reads/writes; if unreachable, pipeline continues without caching.  
- forceRefresh: callers may pass `forceRefresh=true` to bypass cache and force a fresh analysis.  
- TTL clarity: the 24-hour cache window is implemented via a `oneDayAgo` cutoff (results newer than one day are returned).
- **Optional:** `GEO_URL_TRACE=1` on the server logs URL fields (`inputUrl`, `normalizedUrl`, fetch target, final fetched URL, display `result.url`) from `/api/analyze` for debugging.
- **Client AI writing cache** (`src/app/utils/aiWritingExamplesClientCache.ts`): `sessionStorage` is accessed only through a safe helper so embedded / third-party storage restrictions do not throw during hydration.
## Environment Variables

- GOOGLE_GENAI_API_KEY  
  → Gemini API for citation evaluation  

- TAVILY_API_KEY  
  → search question collection (per-analysis pipeline)  

- GEO_CONFIG_TAVILY_SUPPLEMENT (optional, `true` to enable)  
  → optional [trend] supplement for monthly `/api/geo-config/update` research; primary config inputs are official URLs + Semantic Scholar, not Tavily  

- NEXT_PUBLIC_SUPABASE_URL / ANON_KEY  
  → cache storage and retrieval  

- GENERATIVE_MODEL  
  → Gemini model selection

