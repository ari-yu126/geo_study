# 07 — Reference

This document provides a quick index of key files and modules used in the GEO Analyzer system.

---

## Core Pipeline

- `src/lib/runAnalysis.ts`  
  → main orchestration of the analysis pipeline

---

## Analysis

- `src/lib/paragraphAnalyzer.ts`  
  → paragraph-level rule-based analysis (definition, info density, duplication)

- `src/lib/citationEvaluator.ts`  
  → Gemini-based citation scoring (drives "golden paragraph" selection in UI)

- `src/lib/analysisTypes.ts`  
  → core types (AnalysisResult, GeoScores, ChunkCitation)

---

## Scoring

- `src/lib/defaultScoringConfig.ts`  
  → scoring weights and rules (default profiles)

- `src/lib/scoringConfigLoader.ts`  
  → dynamic loading of scoring profiles (runtime overrides)

---

## Recommendation

- `src/lib/recommendationEngine.ts`  
  → generates actionable recommendations (skeleton + LLM phrasing)

---

## LLM / Error Handling

- `src/lib/geminiRetry.ts`  
  → retry / cooldown logic (429 handling, backoff)

- `src/lib/llmError.ts`  
  → LLM error handling and classification (cooldown state)

---

## API Layer

- `src/app/api/analyze/route.ts`  
  → API endpoint handling analysis requests (cache + persist)

---

## Cache / Database

- Supabase table: `analysis_history`  
  → stores cached analysis results (upserted per analysis)

---

## External Services

- **Google Gemini API**  
  → semantic evaluation (citation scoring, recommendation phrasing)

- **Tavily API**  
  → search question collection and filtering