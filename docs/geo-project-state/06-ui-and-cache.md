# 06 — UI and Cache

## UI Flow
1. User inputs URL and triggers analysis  
2. Request sent to `/api/analyze`  
3. Loading state displayed while pipeline runs  
4. Response received (`AnalysisResult`)  
5. UI renders:
   - **Left panel (AuditPanel):** headline GEO score and per-axis-style breakdown first; then the main analysis blocks in this order: **discovered issues → question coverage → strengths (“what already works”) → content improvement guide** (deterministic recommendations from the recommendation engine; optional AI writing examples only when the user triggers them). Other blocks (e.g. platform constraints, improvement opportunities when no rule-based guide exists, golden paragraphs) may appear after those.  
   - **Right panel:** iframe preview with markers  

**Why this order:** the panel is organized as **problem → evidence → balance → resolution**—surfacing gaps and question fit before strengths, then actionable guidance—so improvement priorities are easier to follow than a strengths-first layout.

**Final score:** the displayed headline score may apply a **small capped post-blend adjustment** from discovered issue severities (see `preIssuePenaltyFinalScore` / `issuePenaltyPoints` on `scores` in API payloads) so the number stays consistent with the issue list; axis scores and blend math in the engine are unchanged.

## Cache Strategy
Before running analysis:

- normalize URL  
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

