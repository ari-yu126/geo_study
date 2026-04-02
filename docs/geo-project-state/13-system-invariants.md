# GEO Analyzer — System Invariants

This document states **core system invariants**: architectural rules that should **not** change unless the GEO Analyzer is **redesigned** on purpose. It is **conceptual** only—no implementation details, file paths, or formulas.

---

## 1. GEO Score Structure

The GEO score is **always** derived from **axis scores**. The final score is **not** computed directly from raw signals as the primary path.

Conceptual flow:

```text
Signals → Axis Scores → Monthly & Fixed Score → Blending → Caps → Final Score
```

Raw extraction and heuristics feed **axis scores**; the headline GEO score is built from those axes through blending and caps—not by collapsing raw HTML into one number without an axis layer.

---

## 2. Monthly vs Fixed Separation

**Monthly GEO config** (research-backed, versioned configuration) typically controls:

- Weights (per page-type profiles)  
- `issueRules`  
- `passedRules`  
- `opportunityTemplates`  
- `queryTemplates`  
- `scoreBlendAlpha` (when present)  

**Fixed engine** (product runtime, always present):

- Extraction logic  
- Axis score calculation  
- Trust cap  
- Commerce overrides  
- Citation fallback  
- Scoring safeguards  

**Invariant:** Monthly config **adjusts emphasis and strategy**, not the **entire** algorithm. The fixed engine defines the skeleton; monthly config tunes what matters most and what to surface in Explain.

---

## 3. Axis Scores Are the Core Layer

Axis scores are the **central representation** of page quality for GEO. Issues, strengths, opportunities, and recommendations are **derived** from axis scores (and rules applied to the same underlying features), not parallel unrelated scores.

```text
Axis Scores → Explain Layer → Strategy Layer
```

---

## 4. Issues Do Not Compute Score

**Scores are computed first.** Issues **explain** the outcome; they do **not** determine the numeric final score.

- **Scoring computes.**  
- **Issues explain.**

Issue lists may guide opportunities and copy, but they are not the source of truth for `finalScore`.

---

## 5. Opportunities Come From Issues and Weak Axes

Opportunities are generated from:

- **Issues** (what is wrong or missing)  
- **Weak axes** (below-threshold or low partial scores)  
- **Monthly opportunity templates** (when configured)  

They are **prioritized improvement hypotheses**, not a replacement for scoring.

---

## 6. Recommendations Are Narrative Layer

Recommendations are **strategy and narrative**—how to improve—built **on top of** opportunities and broader analysis. They should **not** directly compute scores. Their role is guidance, not to replace the scoring or Explain layers.

---

## 7. Layered Architecture Rule

The system **must** remain **layered**. Conceptual order:

```text
Monthly Config
  → Extraction / Signals
  → Axis Scores
  → Score Blending
  → Explain Layer
  → Recommendation Layer
  → UI
```

**Invariant:** No layer should **skip** another layer in a way that breaks meaning—for example, recommendations should not silently replace axis scoring; UI should not invent scores without the scoring stack. Redesigns may change **how** a layer works, not the **existence** of these responsibilities without an explicit architectural decision.

---

*This document is architectural and conceptual only.*
