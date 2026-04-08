# 12 — Issue System and Score Impact Rules

This project evaluates **AI citation and recommendation likelihood**.  
The **scoring system** calculates the GEO score; the **issue system** explains the score.

Related: `03-scoring-system.md`, `10-scoring-issue-philosophy.md`, `11-system-philosophy-and-architecture-rules.md`, `09-geo-research-policy.md`.

---

## 1. Issue system architecture

Issue rules **must** follow a layered structure:

```text
finalIssueRules =
    coreIssues
  + pageTypeIssues
  + monthlyGeoIssues
```

**Approximate influence (product target):**

| Layer | Share |
|--------|--------|
| Core issues | ~30% |
| Page-type issues | ~30% |
| Monthly GEO issues | ~40% |

Monthly GEO rules may **add** new issues or **adjust** importance, but **must not remove** core or page-type issues.

---

## 2. Issue categories

All issues **must** be categorized as one of:

| Category |
|----------|
| **Missing signals** |
| **Weak signals** |
| **Structural issues** |
| **Opportunities** |

Issues are **not SEO errors.**  
Issues represent **missing or weak signals** that reduce **AI citation and recommendation likelihood**.

---

## 3. Issue → score impact mapping

Each issue should affect **one or more scoring axes**.

**Scoring axes:**

- `citationScore`  
- `answerabilityScore`  
- `structureScore`  
- `trustScore`  
- `paragraphScore` / information density  
- `questionCoverage`  

**Example mapping (illustrative):**

| Issue | Typical axes affected |
|--------|-------------------------|
| Missing summary | citation, answerability |
| No FAQ | citation, answerability |
| Low info density | paragraph, citation |
| Poor structure | structure, citation |
| Missing author | trust |
| Missing schema | structure, trust |
| Description too short (video) | citation, answerability |
| No chapters (video) | structure, answerability |
| No spec table (commerce) | structure, paragraph |
| Weak trust signals | trust |
| Low question coverage | citation, answerability |

Issues must help explain **why specific score components are low**.

---

## 4. Issue severity rules

Severity should be assigned based on **score impact**:

| Severity | When to use |
|----------|-------------|
| **High** | Directly reduces `citationScore` or `answerabilityScore`; missing core content structures; strong negative impact on overall score |
| **Medium** | Affects structure, information density, or trust; moderate impact on score |
| **Low** | Minor structural or metadata issues; small impact on score |
| **Opportunity** | Not an error, but addressing this can **significantly** increase score |

---

## 5. Page-type issue focus

### Editorial pages

Focus on:

- Summary  
- FAQ  
- Comparison  
- Sources  
- Author / date  
- Structured content  

### Video pages

Focus on:

- Description quality  
- Chapters  
- FAQ in description  
- Pinned comment summary  
- Links and structured info in description  

### Commerce pages

Focus on:

- Product schema  
- Price visibility  
- Spec tables  
- Pros / cons  
- Comparison tables  
- Shipping / returns info  
- Review summaries  
- Trust signals  

---

## 6. Key principle

The **scoring system** calculates the GEO score.  
The **issue system** explains the GEO score.

Issues must explain:

> *“What signals are missing and what would increase the GEO score?”*

Issues are **missing or weak signals** that reduce **AI citation and recommendation likelihood**.

Issue rules **must** be layered: **core issues**, **page-type issues**, and **monthly GEO issues**.

---

## 7. GEO issue system summary (quick reference)

- **Composition:** `issues = coreIssues + pageTypeIssues + monthlyGeoIssues`
- **Nature:** Issues are **missing or weak AI citation signals** (not generic SEO errors).
- **Mapping:** Each issue should map to one or more score axes — citation, answerability, structure, trust, paragraph (density), coverage.
- **Severity (vs impact):**
  - **High** → citation / answerability impact (or missing core structures, strong overall drag)
  - **Medium** → structure, trust, paragraph / density
  - **Low** → minor structure or metadata
  - **Opportunity** → not an error; high potential to raise score if addressed
- **Division of labor:** **Scoring** calculates the score; **issues** explain the score.

**Canonical framing:**

The scoring system calculates the GEO score, but the issue system explains the score.  
Issues are missing or weak signals that reduce AI citation and recommendation likelihood.  
Issue rules must be layered: core issues, page-type issues, and monthly GEO issues.
