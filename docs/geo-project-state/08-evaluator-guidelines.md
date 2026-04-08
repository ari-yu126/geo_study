## Role in GEO System

This evaluator is responsible for converting page content into structured GEO scores
that estimate the likelihood of AI search engines citing the content.

This evaluator is used by:
- Editorial page analysis
- Commerce page analysis
- Video transcript analysis
- GEO scoring engine
- Recommendation engine (indirectly)

The evaluator output becomes part of geo_analysis_results.result_json
and is used for scoring, issue detection, and recommendations.

# GEO Evaluator Guidelines

This file contains the evaluation instructions and JSON schema used by the GEO (Generative Engine Optimization) evaluator when assessing whether a page or content is likely to be cited by AI search agents (Google AI Overview, Perplexity, ChatGPT).

Use these guidelines as the canonical prompt and schema whenever calling an LLM to evaluate citation likelihood. Keep the content concise and machine-readable.

---

## Evaluation Rules (short)

- Focus on INFORMATION GAIN: prioritize novel, concrete facts and definitions.  
- Prefer structured data: tables, lists, spec blocks, and clear numeric values.  
- Penalize generic marketing language, fluff, vague superlatives.  
- Reward specific numbers, specs, comparisons, definitions, and sourceable facts.  
- Evaluate semantic value and answer completeness rather than keyword matches.

---

## Runtime Prompt (Use exactly as input to the LLM)

You are a GEO evaluator. Follow these rules strictly:

1. Prioritize information gain (new facts, definitions, precise numbers).
2. Give positive weight to structured data (tables, lists, spec blocks).
3. Penalize generic marketing language, vague claims, or fluff.
4. Reward concrete values: specifications, comparisons, measurements, citations.
5. Evaluate semantic value (does the content directly answer likely user questions?) — do not rely on keyword frequency.

Return STRICT JSON only, following the schema below. Do not include any explanations or extra text.

---

## Output JSON Schema

Return JSON matching this shape:

```json
{
  "overall_score": 0,
  "info_gain_score": 0,
  "structure_score": 0,
  "factuality_score": 0,
  "marketing_penalty": 0,
  "citation_likelihood": "low",
  "top_strengths": [],
  "top_weaknesses": [],
  "issues": [
    {
      "id": "string",
      "label": "string",
      "severity": "low|medium|high",
      "note": "string"
    }
  ],
  "metadata": {
    "evaluated_at": "ISO timestamp",
    "model_version": "string (optional)",
    "page_type_hint": "editorial|commerce|video (optional)"
  }
}
```

Scoring guidance:
- overall_score: integer 0–100 (aggregate).  
- info_gain_score / structure_score / factuality_score: 0–100 each.  
- marketing_penalty: 0–100 (higher = worse).  
- citation_likelihood: enum "high" | "medium" | "low".

---

## Example LLM Instruction Usage (pseudo)

- Input: page text or extracted blocks (title, description, paragraphs, tables).  
- System: the Runtime Prompt above.  
- Output: JSON conforming to the schema.

Store the returned JSON into `geo_analysis_results.result_json` and use the numeric fields for analytics.

---

## Placement suggestion

Recommended path in this repository:

```
docs/geo-project-state/08-evaluator-guidelines.md
```

Rationale:
- Keeps evaluation guidance versioned with project docs.  
- Easy for developers and prompts to reference.  
- Serves as canonical source for prompt engineering and audits.

---

## Operational notes

- Keep the prompt and schema stable; if you change the schema, bump the evaluator version and document migration steps.  
- Validate the LLM output strictly: parse JSON, validate types and ranges, and reject non-conforming responses.  
- Log the raw LLM response on failures for debugging, but never store raw LLM messages in public or user-facing tables.

---

Last updated: 2026-03-24

