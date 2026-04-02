# 02 — Analysis System (Core Concepts & Types)

This document groups the core analysis concepts, paragraph analysis rules, LLM evaluation notes, and key types used across the analysis pipeline.

## Core concepts
- GEO score measures page utility for AI citation and user answerability.
- Evaluation is paragraph-first: we extract chunks and score each for information density, definition ratio, and citation potential.
- Community fit: collected user/community questions (Tavily) are matched to page content to compute communityFit and question coverage.
👉 The system combines rule-based analysis and LLM-based evaluation to approximate real AI citation behavior.

## Paragraph analysis rules
Paragraphs are evaluated based on structural and informational quality:

- **Definition patterns**  
  → "~이다", "is a", "refers to"

- **Promotional tone**  
  → overly marketing-heavy language is penalized

- **Length suitability**  
  → optimal range: 15–80 words

- **Information density**  
  → ratio of numeric values, entities, and structured data

## LLM evaluation (Gemini)

- Input: extracted chunks (max ~15) + Tavily questions  
- Output per chunk: citation_score (0–10), community_fit (0–10), reason  

LLM is used strictly for semantic evaluation:
- scoring citation likelihood  
- estimating community relevance  

It does NOT control scoring weights or decision logic.

## Key types (summary)
These types define the data contract between analysis, scoring, and recommendation layers.
- AnalysisResult: url, meta, scores, contentQuality, trustSignals, paragraphStats, chunkCitations  
- GeoScores: structureScore, answerabilityScore, trustScore, paragraphScore, citationScore, questionCoverage, finalScore  
- ChunkCitation: index, text, score, reason, communityFitScore?, infoDensity?

For implementation details see `src/lib/paragraphAnalyzer.ts`, `src/lib/citationEvaluator.ts`, and `src/lib/analysisTypes.ts`.

## 📌 Role in System

This module is responsible for extracting and evaluating raw content signals.

It feeds structured data into:
- the scoring system (03-scoring-system.md)
- the recommendation engine (04-recommendation-system.md)