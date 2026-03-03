# GEO Analyzer — 프로젝트 목표 및 단계별 흐름 (Gemini용)

> AI(제미나이 등)가 프로젝트의 목표, 원리, 흐름을 처음부터 이해할 수 있도록 정리했습니다.

---

## 1. 프로젝트 목표

**"AI 인용 가능성 예측 및 최적화 엔진"**

AI(Google AI Overview, ChatGPT, Perplexity 등)가 이 페이지를 정답 출처로 채택할 것인가를 시뮬레이션하고, 개선 방향을 제시한다.

---

## 2. 핵심 원리

### 2.1 단순 SEO가 아니다

- **SEO 툴**: 키워드 밀도, 메타 태그, 백링크
- **GEO Analyzer**: "AI가 이 문단을 인용할 것인가?" 시뮬레이션

### 2.2 질문/답변 관점

- **비교 대상**: "사용자가 실제로 던지는 질문" vs "현재 페이지가 제공하는 답변 구조"
- **평가 질문**: AI가 이 페이지를 정답 출처로 쓰고 싶어 할지 판단

### 2.3 하이브리드 분석

| 축 | 설명 | 방식 |
|---|---|---|
| **Structure** | 웹 표준 (Title, H1, Schema 등) | 규칙 기반 |
| **Citation** | AI 인용 가능성 | Gemini 의미적 평가 |
| **Density** | 데이터 밀도 (숫자, 테이블, 리스트) | 수학적 알고리즘 |

### 2.4 증거 기반 권위

- 하드코딩 화이트리스트가 아님
- **Tavily 검색 노출 데이터**로 도메인 신뢰도 역산 (`hasSearchExposure`)

### 2.5 가변 가중치 로직

- Ace Chunk 발견 시 → 구조/브랜드 페널티 상쇄
- 시뮬레이션: 개선안 적용 시 예상 점수 (Before vs After)

### 2.6 질문 커버리지 뷰

| 구분 | 설명 |
|------|------|
| `searchQuestions` | 검색/커뮤니티 수집 질문 |
| `searchQuestionCovered` | 페이지가 잘 답하는 질문 (true/false) |
| `uncoveredQuestions` | 아직 미답변 질문 → 추천 입력 |

### 2.7 AI 예상 질문 & PPT 리포트

- **predictedQuestions**: 사용자가 던질 법한 질문 Top N (5~8개)
- **predictedUncoveredTop3**: **본문에 없는** 사용자 예상 질문 Top 3 (보강 우선순위)
- **PPT 리포트**: 점수 요약, 키워드, 질문 커버리지, 본문에 없는 Top 3, 황금 문단, 액션 플랜

---

## 3. AI(Gemini) 활용

**단순 계산은 TypeScript, 문맥/창작만 `generateContent`** 호출.

| 단계 | 역할 | 출력 |
|------|------|------|
| **채점** | 문단이 "진짜 해결책"인가? | `ChunkCitation[]` |
| **추천** | H2/H3, 블록, 예상 질문 생성 | `trendSummary`, `actionPlan`, `predictedQuestions`, `predictedUncoveredTop3` |
| **설정 업데이트** | GEO 기준 최신 트렌드 반영 | `/api/geo-config/update` (월 1회 권장) |

---

## 4. API 활용 전략

| API | 시점 | 목적 |
|-----|------|------|
| **Tavily** | 분석 초기 | 검색 노출 여부, 검색 질문 수집 |
| **Gemini** | 분석 중/후 | 인용 채점, 추천, 예상 질문 |
| **Proxy** | iframe | CORS 해결, 사이트 프리뷰 |

---

## 5. 단계별 흐름

### 5.1 사용자 (UI)

```
URL 입력 → [분석] → 좌측 패널
  ├ 점수 (종합, 카테고리별)
  ├ AI 전략 제언 (recommendations)
  ├ 시뮬레이션 (개선안 적용 시 예상 점수)
  ├ 질문 커버리지 (수집 질문, 답변/미답변)
  ├ 본문에 없는 사용자 예상 질문 Top 3
  ├ AI 예상 질문 Top N
  ├ 황금 문단 (인용 확률 TOP 3)
  ├ 발견된 이슈
  └ 잘된 점

우측: 사이트 iframe (황금 문단 하이라이트, 이슈 마커)

[PPT 리포트 다운로드]
```

### 5.2 분석 파이프라인

```
1. loadActiveScoringConfig()
2. fetchHtml() → extractMetaAndContent()
3. extractSeedKeywords() → fetchSearchQuestions() (Tavily/fallback)
4. 병렬: analyzeParagraphs() | evaluateCitations() ★Gemini
5. 규칙 기반: structure, answerability, trust, questionCoverage
6. 가변 가중치 & 최종 점수
7. deriveAuditIssues() → generateGeoRecommendations() ★Gemini
   → trendSummary, contentGapSummary, actionPlan,
     predictedQuestions, predictedUncoveredTop3
8. AnalysisResult 반환
```

### 5.3 시뮬레이션

- Data Density +15, Coverage 100%, Structure +20
- Citation 있으면 85점 수준 가정
- Before vs After 비교

### 5.4 PPT 리포트 슬라이드

| 슬라이드 | 내용 |
|----------|------|
| 표지 | 제목, URL, 종합 등급 |
| 종합 점수 | 구조, 질문 커버리지, 최종 |
| 핵심 키워드 | seedKeywords |
| 질문 커버리지 | 수집 질문, 답변 완료/미답변 |
| 본문에 없는 Top 3 | predictedUncoveredTop3 |
| AI 예상 질문 Top N | predictedQuestions |
| 황금 문단 | chunkCitations TOP 3 |
| 메타 태그 | Title, Description, OG |
| 액션 플랜 | suggestedHeadings, suggestedBlocks |
| 개선 권고사항 | tips + priorityNotes |
| 결론 | 종합, 즉시 실행 항목 |

---

## 6. 환경 변수

| 변수 | 용도 |
|------|------|
| `GOOGLE_GENAI_API_KEY` / `GEMINI_API_KEY` | Gemini (인용, 추천, 예상 질문) |
| `TAVILY_API_KEY` | 검색 질문 (없으면 템플릿) |
| `NEXT_PUBLIC_SUPABASE_*` | GEO 설정, 캐시 |

---

## 7. 디렉터리 매핑

| 경로 | 역할 |
|------|------|
| `app/page.tsx` | 메인, URL 입력 → 분석 |
| `components/AuditPanel.tsx` | 좌측 패널 (점수, 질문 뷰, 황금 문단, 이슈) |
| `components/AuditMarker.tsx` | 우측 iframe 오버레이 |
| `api/analyze/route.ts` | POST GEO 분석 |
| `api/proxy/route.ts` | HTML 프록시 |
| `api/geo-config/update/route.ts` | AI GEO 설정 업데이트 |
| `utils/pptExporter.ts` | PPT 리포트 생성 |
| `lib/runAnalysis.ts` | 분석 파이프라인 |
| `lib/citationEvaluator.ts` | Gemini 인용 채점 |
| `lib/recommendationEngine.ts` | Gemini 추천 + 예상 질문 |
| `lib/searchQuestions.ts` | Tavily 검색 질문 |
| `lib/paragraphAnalyzer.ts` | 문단 품질 |
| `lib/issueDetector.ts` | AuditIssue, PassedCheck |
| `lib/simulationScore.ts` | 시뮬레이션 점수 |

---

## 8. 개발 원칙

1. **비교 가능한 보고**: Before vs After 시뮬레이션
2. **유연한 예외**: 다나와/오토뷰/블로그 등 사이트 성격별 가변 가중치
3. **API 최소화**: 단순 계산은 TS, 문맥/창작만 Gemini
