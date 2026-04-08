# 01 — Project Overview

**GEO Analyzer** is a system that evaluates how well a web page is optimized for **AI-driven search environments (Generative Engine Optimization)**.

It analyzes whether AI systems such as ChatGPT, Google AI Overview, and Perplexity are likely to **select and cite a page as a reliable answer source**, and provides actionable recommendations for improvement.

---

## ✨ Key Differentiator

Traditional SEO tools focus on rankings.

GEO Analyzer focuses on a different question:

> “Will an AI system choose this paragraph as an answer?”

It evaluates content at the **paragraph level** and models how AI systems extract, interpret, and cite information.

---

## 🧠 Core Architecture

GEO Analyzer consists of two main systems:

### 1. Analysis Engine
- Crawls and parses HTML content
- Performs paragraph-level quality analysis (definition patterns, information density, duplication)
- Evaluates AI citation likelihood using Gemini
- Computes GEO scores based on multiple signals

### 2. Recommendation Engine ⭐️
- Translates analysis results into actionable strategies
- Applies page-type-specific rules (commerce, editorial, video)
- Suggests AI-friendly structures:
  - comparison tables
  - FAQ blocks
  - summaries
  - pros/cons and verdict sections

---

## 🚀 Key Features

- **GEO Score (0–100)**  
  Combines citation likelihood, content quality, structure, and trust signals

- **Question Coverage**  
  Measures how well the page answers real user/search questions

- **Golden Paragraphs**  
  Identifies top paragraphs most likely to be cited by AI

- **Actionable Recommendations**  
    Generates structured strategies using the Recommendation Engine (tables, FAQ, summaries, pros/cons)

- **PPT Export**  
  Generates a presentation-ready report from analysis results

---

## 🔄 Workflow (High-level)
This workflow represents the end-to-end flow of the GEO Analyzer.

Starting from a user-provided URL, the system performs analysis, computes GEO scores, and generates actionable recommendations, which are then rendered in the UI or exported as a report.

URL input → Analysis → Scoring → Recommendation → UI / Report

---

## ⚙️ System Flow

1. HTML crawling and content extraction  
2. Primary topic detection and keyword extraction  
3. Search question collection (Tavily) + relevance filtering  
4. Parallel execution:
   - paragraph analysis  
   - citation evaluation (Gemini)  
5. GEO score calculation  
6. Recommendation generation  
7. result rendering (UI + report)

---

## 🎯 Project Goals

- Optimize content for AI-first search environments  
- Increase AI citation likelihood through structured content  
- Provide actionable strategies, not just scores  
- Bridge traditional SEO and GEO (Generative Engine Optimization)  
- Support multiple page types with tailored optimization logic  

---

## 🧩 Supported Page Types

- Editorial pages (blogs, reviews, listicles)  
- Commerce pages (product / shopping)  
- Video pages (YouTube)

---

## 🛠 Tech Stack

- Next.js (App Router)  
- React  
- TypeScript  
- Tailwind CSS  
- Cheerio  
- Supabase  
- Google Gemini API  
- Tavily API

## 📌 Notes

- GEO scoring combines rule-based evaluation and LLM-based citation analysis  
- Recommendation generation is deterministic + LLM-assisted (Gemini)