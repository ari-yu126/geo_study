# ⚠️ Legacy Document

This file is deprecated.

The documentation has been refactored into modular files under:

docs/gemini-project-state/

Please refer to the new structure instead.

# GEO Analyzer — 프로젝트 현재 상태 (Gemini용)

> NOTE: 이 문서는 섹션별로 분리되어 `docs/gemini-project-state/` 아래에 별도 파일로 관리됩니다.
> 원문 보존용으로 이 파일은 그대로 두며, 실제 편집은 `docs/gemini-project-state/`의 개별 파일에서 진행하세요.

> 섹션 파일 예:
> - `docs/gemini-project-state/01-project-overview.md`
> - `docs/gemini-project-state/02-core-concepts.md`
> - `docs/gemini-project-state/03-scoring.md`
> - `...` (전체 목록은 repo의 docs/gemini-project-state/ 폴더 참조)

---

## 1. 프로젝트 개요

**GEO Analyzer**는 웹페이지의 **GEO(Generative Engine Optimization)** 점수를 분석하는 도구입니다.  
AI 검색(AI Overview, ChatGPT, Perplexity 등)에 잘 노출되려면 어떤 점을 개선해야 하는지 진단하고, 구체적인 수정 예시를 제공합니다.

### 기술 스택
- **Next.js 16.1.6** (App Router)
- **React 19**
- **TypeScript**
- **Tailwind CSS v4**
- **Cheerio** (HTML 파싱)
- **Supabase** (캐시, GEO 평가 설정 저장)
- **Google Gemini 2.0 Flash** (문단별 인용 가능성 평가)
- **Tavily API** (실제 검색 질문 수집, 선택)

---

## 2. 핵심 개념

### GEO 점수 (0~100)

| 축 | 비중 | 설명 |
|---|---|---|
| **AI 인용 가능성 (citationScore)** | 40% | LLM(Gemini)이 문단별로 “AI에 인용될 확률” 평가 |
| **문단 품질 (paragraphScore)** | 15% | 정의형 문장 비율, 과장 표현, 중복, 질문형 H2 등 |
| **답변가능성 (answerabilityScore)** | 15% | 첫 문단, 인용 가능 문장, 콘텐츠 분량 등 |
| **SEO 구조 (structureScore)** | 15% | Title, Description, H1/H2, OG, Schema 등 |
| **신뢰 신호 (trustScore)** | 15% | 저자, 발행일, 수정일, 연락처, 회사소개 링크 |

> LLM 평가가 없을 때는 문단 품질 35%, 답변가능성 25%, SEO 20%, 신뢰 15%, 질문 커버리지 5%로 대체.

### 평가 철학
- **역공학**: “AI가 실제로 인용하는 문단의 공통 패턴”을 모델링
- **문단 단위**: 페이지 전체뿐 아니라 문단별 품질·인용 가능성 분석
- **커뮤니티 언어**: Tavily로 수집한 실제 검색 질문과의 적합도(communityFit) 반영

---

## 2-1. 점수 산정 기준 (현재)

### A. 일반 웹페이지

| 축 | 산출 방식 | 비중 (인용 있음) | 비중 (인용 없음) |
|---|---|---|---|
| **citationScore** | Gemini 문단별 인용 점수 → 합산. 에이스 문단 있으면 하한 상향. 권위/데이터 페이지 보정 | 45%~65% (가변) | — |
| **paragraphScore** | paragraphStats → 정의비율, 적정길이, 과장/중복 감점, 질문H2, infoDensity 등 | 10% | 35% |
| **answerabilityScore** | 규칙 기반 (첫 문단, 인용문장, 콘텐츠 분량, 표, 목록 등) | 15% | 25% |
| **structureScore** | Title/Description/H1/H2/OG/Canonical/Schema 등 structureRules | 5%~15% (가변) | 20% |
| **trustScore** | 저자, 발행일, 연락처 등 trustRules. Top Tier/실제 AI 인용 +20, 검색 노출 +5 | 5%~15% (가변) | 15% |

**citationScore 보정**
- citationScore < 0이고 hasAuthority → 60점
- citationScore < 0이고 isDataPage → 40+α (스키마·권위 가산)
- citationScore 0~70이고 (isDataPage \|\| hasAuthority) → ×1.3 + 15
- isDataPage && hasAuthority → 최소 75점
- 유튜브 URL → 최소 70점

**가변 가중치**
- maxChunkScore(에이스 문단) 높을수록 citation 비중 45%→65%, structure/trust 비중 감소

**최종 점수 상한**
- hasDomainAuthority 또는 hasActualAiCitation → 상한 없음
- hasSearchExposure만 있음 → 79점 상한
- 둘 다 없음 → 70점 상한

---

### B. 유튜브 (전용 파이프라인)

유튜브 URL은 `fetchYouTubeMetadata` → `runGeminiVideoAnalysis` → `buildYouTubeAnalysisResult`로 처리. 일반 파이프라인 미사용.

| 축 | 산출 방식 |
|---|---|
| **citationScore** | Gemini(희소성+전문성+실질데이터)/3. t= 파라미터가 시드 키워드와 일치 시 +8 |
| **paragraphScore** | 0.6×Gemini paragraphScore + 0.4×infoDensityScore |
| **answerabilityScore** | 0.5×82 + 0.5×min(100, infoDensityScore+40) |
| **structureScore** | hasActualAiCitation ? 85 : 75 |
| **trustScore** | hasActualAiCitation ? 88 : 75 |

**가중치 (최종 점수)**  
citation 35%, paragraph 20%, answerability 20%, structure 12%, trust 13%.

**정보 밀도**  
설명란의 전체 단어 대비 모델명·수치 비중(computeChunkInfoDensity) → infoDensityScore.

**잘된 점(PassedCheck)**  
config의 youtubePassedCheckRules 기반: 제목 최적화, 정보 밀도(300자), 챕터(타임스탬프), 권위, AI 평가 문구.

---

### C. 규칙 기반 체크 (defaultScoringConfig)

- **structureRules**: title_exists, desc_exists, h1_single, h2_depth, og_tags, canonical, schema 등
- **answerabilityRules**: first_para, has_definition, quotable, content_length_min, tables_min 등
- **trustRules**: has_domain_authority, has_search_exposure, has_author, has_publish_date 등
- **issueRules**: 각 규칙 미충족 시 AuditIssue 생성 (label, description, priority, fixExamples)

---

## 3. 디렉터리 구조

```
src/
├── app/
│   ├── page.tsx              # 메인 페이지 (URL 입력 → 분석 → 좌우 분할 UI)
│   ├── layout.tsx
│   ├── globals.css
│   ├── components/
│   │   ├── AuditPanel.tsx    # 좌측 패널 (점수, 이슈, 황금 문단, 개선 예시)
│   │   ├── AuditMarker.tsx   # 우측 iframe 오버레이 (이슈 마커)
│   │   ├── ResultDashboard.tsx
│   │   ├── ScoreGauge.tsx
│   │   ├── CategoryBar.tsx
│   │   └── Sidebar.tsx
│   ├── api/
│   │   ├── analyze/route.ts      # POST: GEO 분석 (캐시 조회/저장)
│   │   ├── proxy/route.ts        # GET: HTML 프록시 + 황금 문단 하이라이트
│   │   ├── geo-config/route.ts   # GET: Supabase 저장 GEO 설정
│   │   └── geo-config/update/route.ts  # POST: AI로 설정 업데이트
│   └── utils/
│       └── pptExporter.ts        # PPT 리포트 생성
└── lib/
    ├── analysisTypes.ts     # 모든 타입 정의
    ├── runAnalysis.ts       # 분석 파이프라인 진입점
    ├── htmlAnalyzer.ts      # HTML 크롤링, 메타/본문 추출, Trust 신호
    ├── paragraphAnalyzer.ts # 문단별 정의비율, 과장, 중복, infoDensity, communityFit
    ├── citationEvaluator.ts # Gemini 배치 호출: 문단별 인용 점수 + community_fit
    ├── keywordExtractor.ts  # 시드 키워드 추출
    ├── searchQuestions.ts   # Tavily API로 검색 질문 수집
    ├── checkEvaluator.ts    # 규칙별 체크 (title_exists 등)
    ├── defaultScoringConfig.ts  # GEO v3.0 평가 규칙
    ├── scoringConfigLoader.ts   # Supabase 또는 기본 설정 로드
    ├── issueDetector.ts     # AuditIssue, PassedCheck 도출
    └── supabase.ts          # 클라이언트 + isSupabaseReachable
```

---

## 4. 분석 파이프라인 (`runAnalysis`)

```
1. HTML 크롤링 (fetchHtml)
2. 메타/본문 추출 (extractMetaAndContent)
   → meta, headings, contentText, contentQuality, trustSignals
3. 시드 키워드 추출 (extractSeedKeywords)
4. Tavily 검색 질문 수집 (fetchSearchQuestions)
5. 병렬 실행:
   - analyzeParagraphs(html, headings, searchQuestions)
     → definitionRatio, goodLengthRatio, fluffRatio, duplicateRatio,
       questionH2Ratio, earlySummaryExists, communityFitScore, infoDensity
   - evaluateCitations(chunks, searchQuestions)  ← Gemini 호출
     → ChunkCitation[] (index, text, score, reason, communityFitScore, infoDensity)
6. structure/answerability/trust 점수 (규칙 기반)
7. 최종 점수 가중 합산
8. AnalysisResult 반환
```

---

## 5. 주요 타입 (`analysisTypes.ts`)

| 타입 | 용도 |
|------|------|
| `AnalysisResult` | 최종 분석 결과 (url, meta, scores, contentQuality, trustSignals, paragraphStats, chunkCitations) |
| `GeoScores` | structureScore, answerabilityScore, trustScore, paragraphScore, citationScore, questionCoverage, finalScore |
| `ParagraphStats` | 정의비율, 적정길이비율, 과장비율, 중복비율, 질문H2비율, earlySummaryExists, communityFitScore, infoDensity |
| `ChunkCitation` | 문단 index, text, score(0–10), reason, communityFitScore?, infoDensity? |
| `ContentQuality` | contentLength, tableCount, listCount, h2Count, quotableSentenceCount, firstParagraphLength, hasDefinitionPattern, hasPriceInfo |
| `TrustSignals` | hasAuthor, hasPublishDate, hasModifiedDate, hasContactLink, hasAboutLink |
| `GeoScoringConfig` | structureRules, answerabilityRules, trustRules, weights, issueRules |

---

## 6. 문단 분석 (정규식 기반)

- **정의형 문장**: `~이다`, `~를 의미한다`, `X is a Y`, `refers to` 등
- **과장 표현**: `진짜 최고`, `absolutely amazing`, `강력 추천` 등
- **적정 길이**: 15~80단어
- **숫자 비율**: %, 원, $, kg 등 포함 문단 비율
- **고유명사 비율**: 대문자 명사, 한국어 고유명사
- **infoDensity**: 숫자·고유명사 기반 정보 밀도
- **communityFitScore**: 검색 질문 키워드와 문단 토큰 매칭 비율

---

## 7. LLM 인용 평가 (Gemini)

- **입력**: `extractChunks`로 추출한 문단(최대 15개) + Tavily 검색 질문
- **프롬프트**: 각 문단에 대해
  - `citation_score` (0–10): AI에 인용될 가능성
  - `community_fit` (0–10): 실제 검색 질문에 직접 답하는 정도
- **출력**: `ChunkCitation[]` (index, score, reason, communityFitScore, infoDensity)

---

## 8. UI 흐름

1. **첫 화면**: URL 입력 → 분석 버튼
2. **분석 후**: 좌측 패널 + 우측 iframe 사이트 프리뷰
3. **좌측 패널**:
   - 종합 GEO 점수 + 카테고리별 점수
   - 황금 문단 (인용 확률 TOP 3) — 별표 강조
   - 발견된 이슈 (고/중/저) + 수정 예시 (복사 가능)
   - 잘된 점 (펼쳐보기)
4. **우측 iframe**:
   - `/api/proxy?url=...&golden=2,5,7` 로 로드
   - 황금 문단 3개에 노란색 왼쪽 보더 + 배경 하이라이트
   - 이슈 위치에 마커 오버레이

---

## 9. 캐시 (Supabase)

- **테이블**: `analysis_history` (url, normalized_url, geo_score, question_coverage, result_json)
- **유효기간**: 24시간
- **조건**: `answerabilityScore`가 있는 v3 결과만 캐시로 사용 (구버전은 재분석)

---

## 10. 환경 변수

```
GOOGLE_GENAI_API_KEY   # Gemini 2.0 Flash (인용 평가)
TAVILY_API_KEY         # 검색 질문 수집 (선택)
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

---

## 11. 참고 문서

- GEO 평가 기준: `src/lib/defaultScoringConfig.ts`
- aisearchvisibility.ai GEO Scoring Methodology v2.0 기반
- 평가는 페이지 전체 + 문단 단위로 동시 적용
