# Agentic System Optimization — Research & Literature Review

> **Date:** February 24, 2026
> **Purpose:** Comprehensive review of optimization strategies for agentic AI systems, with applicability analysis for Business IQ Enterprise.
> **Status:** Research complete. Implementation deferred until performance data validates the need.

---

## Table of Contents

1. [Industry Articles](#industry-articles)
2. [Academic Papers (arXiv)](#academic-papers-arxiv)
3. [Current Optimizations in BIQ](#current-optimizations-in-biq)
4. [High-Impact Opportunities](#high-impact-opportunities)
5. [Medium-Impact Opportunities](#medium-impact-opportunities)
6. [Not Applicable / Lower Priority](#not-applicable--lower-priority)
7. [Recommended Priority Order](#recommended-priority-order)

---

## Industry Articles

### 1. Optimization Strategies for Agentic Systems

- **Author:** Rasul Rzayev
- **Source:** Medium
- **Date:** January 2, 2026
- **URL:** *(Medium article — search "Rzayev optimization strategies agentic systems 2026")*

**Key Findings:**
- **Semantic caching** — Cache LLM responses keyed by semantic similarity of queries, not exact match. 30-70% cost reduction.
- **Prompt caching** — OpenAI/Anthropic auto-cache identical prompt prefixes. Cached input tokens are 50% cheaper (OpenAI) or 90% cheaper (Anthropic).
- **Context compression** — Remove redundant information from prompts before sending to LLM.
- **Data format optimization** — Token efficiency ranking: YAML > Markdown > JSON > XML. YAML uses ~20% fewer tokens than JSON for equivalent data.
- **Model selection/routing** — Use smaller models for simple tasks, reserve large models for complex reasoning. Route dynamically based on query complexity.
- **Agentic design patterns** — ReAct (Reasoning + Acting), Reflection (self-critique loop), Planning (decompose before executing), Multi-Agent (specialized agents collaborate).
- **Memory/context management** — Sliding window, summarization, hierarchical memory for long conversations.
- **LLM gateways** — Centralized proxy for rate limiting, caching, model routing, cost tracking.
- **Security/guardrails checklist** — Input validation, output sanitization, PII detection, token budget limits, sandboxed execution.

---

### 2. How I Cut Agentic Workflow Latency by 3-5x

- **Author:** Rohit Jacob
- **Source:** HackerNoon
- **Date:** August 19, 2025
- **URL:** *(HackerNoon — search "Rohit Jacob cut agentic workflow latency 3-5x")*

**Key Findings:**
- **Step count trimming** — Fewer LLM reasoning steps = proportionally less latency. Eliminate unnecessary intermediate steps.
- **Parallelization** — Independent agent/tool calls should execute concurrently, not sequentially. 3-5x speedup demonstrated.
- **Cut unnecessary model calls** — Many "thinking" steps can be replaced with deterministic code.
- **Model-task matching** — Use GPT-4o-mini for extraction, GPT-4o for complex reasoning. Don't use a sledgehammer for thumbtacks.
- **Prompt optimization** — Shorter prompts = fewer input tokens = faster time-to-first-token.
- **Cache everything** — Cache intermediate LLM results, tool outputs, and final responses. 40-70% latency reduction for repeat/similar queries.
- **Speculative decoding** — Use a small draft model to predict tokens, verify with the large model in batch. Reduces autoregressive bottleneck.
- **Strategic fine-tuning** — Fine-tune small models on domain-specific tasks to replace larger models entirely.
- **Monitoring** — Track per-step latency, token usage, cache hit rates. Can't optimize what you don't measure.

---

### 3. How to Reduce Agent Latency in Agentic AI Systems

- **Author:** Manu Mishra
- **Source:** Medium
- **Date:** December 24, 2025
- **URL:** *(Medium — search "Manu Mishra reduce agent latency agentic AI systems")*

**Key Findings:**
- **Model quantization** — INT8/INT4 quantization gives 2-4x faster inference with minimal quality loss. *(Applies to self-hosted models only.)*
- **vLLM/SGLang runtimes** — Optimized inference engines achieve 30-70% latency reduction vs naive serving. *(Self-hosted only.)*
- **Short prompts** — 20-40% faster time-to-first-token with concise prompts.
- **Fewer agent loops** — Each reasoning loop adds full LLM round-trip. Reduce loop count by giving the agent more context upfront.
- **Fewer external calls** — Network I/O for APIs/databases adds 100ms-1s per call. Batch or eliminate where possible. Up to 10x speedup when external calls are the bottleneck.

---

## Academic Papers (arXiv)

### 4. Speculative Actions: A Lossless Framework for Faster Agentic Systems

- **Authors:** Ye et al.
- **Date:** October 2025
- **arXiv:** [2510.04371](https://arxiv.org/abs/2510.04371)
- **Category:** cs.AI

**Abstract:** Proposes predicting likely next-actions using a faster/cheaper model, then executing them speculatively in parallel with the primary model's reasoning. If the prediction matches the primary model's decision, the result is already available — eliminating one full round-trip.

**Key Results:**
- Up to 55% next-action prediction accuracy
- Significant latency reduction (proportional to prediction accuracy)
- Lossless — never degrades output quality; speculative results are discarded on misprediction

**Applicability to BIQ:** Moderate. Would require a lightweight classifier to predict which tool the chat-manager agent will invoke, and pre-fetch data for the predicted tool. Most useful for the chat-manager → insights-analyzer routing path.

---

### 5. Optimizing Agentic Workflows using Meta-tools (AWO Framework)

- **Authors:** Abuzakuk et al.
- **Date:** January 2026
- **arXiv:** [2601.22037](https://arxiv.org/abs/2601.22037)
- **Category:** cs.AI

**Abstract:** Introduces the AWO (Agentic Workflow Optimization) framework that discovers recurring sequences of tool calls and transforms them into deterministic "meta-tools." Instead of the LLM reasoning through 3 steps every time, a single meta-tool executes the deterministic sequence in one shot.

**Key Results:**
- 11.9% reduction in LLM calls
- 4.2% increase in task success rate (fewer decision points = fewer errors)

**Applicability to BIQ:** Medium. Common sequences like "query inventory → calculate reorder point → generate alert" could be bundled into composite tool handlers in the chat-manager agent.

---

### 6. Autellix: An Efficient Serving Engine for LLM Agents

- **Authors:** Luo et al.
- **Date:** February 2025
- **arXiv:** [2502.13965](https://arxiv.org/abs/2502.13965)
- **Category:** cs.DC

**Abstract:** An LLM serving engine that treats agent programs as first-class citizens. Instead of treating each LLM call as an independent request, Autellix understands the program flow, preempts and prioritizes LLM calls based on their position in the agent's execution graph.

**Key Results:**
- 4-15x throughput improvement at equivalent latency vs vLLM
- Program-aware scheduling reduces head-of-line blocking

**Applicability to BIQ:** Not directly applicable (we use API-hosted models, not self-hosted inference). However, the concept of program-aware request prioritization could inform how we queue concurrent agent invocations on the Agentuity platform.

---

### 7. FAME: Optimizing FaaS Platforms for MCP-enabled Agentic Workflows

- **Authors:** Kulkarni et al.
- **Date:** January 2026
- **arXiv:** [2601.14735](https://arxiv.org/abs/2601.14735)
- **Category:** cs.DC

**Abstract:** Proposes the FAME architecture for running agentic workflows on FaaS (Function-as-a-Service) platforms. Decomposes the standard ReAct loop into three specialized functions: Planner (decides what to do), Actor (executes tools), and Evaluator (assesses results). Each function runs as an independent FaaS invocation.

**Key Results:**
- Up to 13x latency reduction
- 88% fewer input tokens (each function gets only its needed context)
- 66% cost savings

**Applicability to BIQ:** High conceptual alignment — Agentuity is itself a FaaS-like platform for agents. The Planner/Actor/Evaluator decomposition maps well to our existing agent architecture (chat-manager as Planner, insights-analyzer as Actor, response formatting as Evaluator). The 88% token reduction from context scoping is particularly relevant.

---

### 8. LLMBridge: Reducing Costs to Access LLMs in a Prompt-Centric Internet

- **Authors:** Martin et al.
- **Date:** October 2024
- **arXiv:** [2410.11857](https://arxiv.org/abs/2410.11857)
- **Category:** cs.NI

**Abstract:** An LLM proxy that sits between applications and LLM providers, implementing semantic caching, model selection, and context management. Acts as a centralized gateway for all LLM traffic.

**Key Results:**
- Production-validated: 12+ months deployment, 100+ users, 14.7K requests
- Demonstrates viability of semantic caching in real-world multi-user systems

**Applicability to BIQ:** Medium. The semantic caching concept is directly applicable. However, we'd implement it at the application layer (KV store + vector similarity) rather than deploying a separate proxy. The model selection aspect is already partially implemented via our TPM fallback logic.

---

### 9. EvoRoute: Experience-Driven Self-Routing LLM Agent Systems

- **Authors:** Zhang et al.
- **Date:** January 2026
- **arXiv:** [2601.02695](https://arxiv.org/abs/2601.02695)
- **Category:** cs.CL, cs.MA

**Abstract:** Formalizes the "Agent System Trilemma" — the tension between performance, cost, and latency. Introduces a self-evolving model routing system that learns from past experience to select Pareto-optimal LLM backends at each step. The routing policy continuously refines itself based on environment feedback.

**Key Results:**
- Up to **80% cost reduction**
- Over **70% latency reduction**
- Performance maintained or improved vs static model assignment

**Applicability to BIQ:** Very High. This is the most impactful paper for our use case. We could implement a simplified version: log query complexity + model used + success/failure, then use this data to route future queries to the cheapest model that historically succeeds for that complexity class.

---

### 10. SCALM: Towards Semantic Caching for Automated Chat Services with LLMs

- **Authors:** Li et al.
- **Date:** May 2024
- **arXiv:** [2406.00025](https://arxiv.org/abs/2406.00025)
- **Category:** cs.CL, cs.AI

**Abstract:** Analyzes real-world human-to-LLM interaction data and identifies failures in existing caching solutions. Proposes SCALM, a cache architecture that emphasizes semantic analysis to identify significant cache entries and patterns, with corresponding storage and eviction strategies.

**Key Results:**
- 63% relative increase in cache hit ratio vs GPTCache
- 77% relative improvement in token savings

**Applicability to BIQ:** High. Directly applicable to the insights-analyzer agent. Users frequently ask similar analytical questions ("top sellers," "revenue trends," "low stock"). A semantic cache using our existing vector store could serve cached responses for semantically similar queries, bypassing both LLM and sandbox execution entirely.

---

### 11. LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression

- **Authors:** Pan et al. (Microsoft Research)
- **Date:** March 2024 (ACL 2024 Findings)
- **arXiv:** [2403.12968](https://arxiv.org/abs/2403.12968)
- **Category:** cs.CL, cs.LG

**Abstract:** Formulates prompt compression as a token classification problem using a small Transformer encoder (XLM-RoBERTa-large). A data distillation procedure derives compression knowledge from an LLM. The compressed prompt is faithful to the original — no hallucinated content.

**Key Results:**
- 2x-5x compression ratio
- 1.6x-2.9x end-to-end latency improvement
- 3x-6x faster than existing compression methods (LLMLingua-1)
- Works across different downstream LLMs

**Applicability to BIQ:** Medium. Could compress the DB schema and system prompt before sending to OpenAI. However, OpenAI's built-in prompt caching may provide similar benefits with zero implementation effort. Worth revisiting if token costs become a significant concern.

---

### 12. Selective Context: Compressing Context to Enhance Inference Efficiency of LLMs

- **Authors:** Li et al.
- **Date:** October 2023 (EMNLP 2023)
- **arXiv:** [2310.06201](https://arxiv.org/abs/2310.06201)
- **Category:** cs.CL

**Abstract:** Identifies and prunes redundant content in LLM input context using self-information metrics. Reduces memory and latency while maintaining output quality.

**Key Results:**
- 50% context cost reduction
- 36% inference memory reduction
- 32% inference time reduction
- Only 0.023 drop in BERTscore (minimal quality impact)

**Applicability to BIQ:** Medium. The principle is already applied manually in our `DB_SCHEMA_ANALYTICS` (slim schema vs full DDL) and `truncateToolResult()`. An automated version could dynamically prune conversation history and tool outputs before passing to the LLM.

---

### 13. RECOMP: Improving Retrieval-Augmented LMs with Compression and Selective Augmentation

- **Authors:** Xu et al.
- **Date:** October 2023
- **arXiv:** [2310.04408](https://arxiv.org/abs/2310.04408)
- **Category:** cs.CL

**Abstract:** Compresses retrieved documents into textual summaries (extractive or abstractive) before prepending to LLM context. Includes selective augmentation — if retrieved docs are irrelevant, returns empty string instead of noisy context.

**Key Results:**
- 6% of original document size (94% compression)
- Minimal performance loss
- Trained compressors transfer across different LLMs

**Applicability to BIQ:** Medium. Relevant if we implement RAG for the knowledge base agent. The selective augmentation concept (return nothing if irrelevant) is particularly useful — avoids polluting the context with unhelpful retrieved content.

---

## Current Optimizations in BIQ

| Optimization | Where Implemented | Research Basis |
|-------------|-------------------|----------------|
| Single-script sandbox (eliminated tool loops) | `src/lib/sandbox.ts` | Step trimming [2, 3], fewer loops [3] |
| Model routing with TPM fallback | `src/lib/ai.ts` | Model-task matching [1, 2], EvoRoute [9] |
| Slim DB schema for prompts | `src/services/analytics.service.ts` | Context compression [1, 12, 13] |
| `truncateToolResult()` caps output size | `src/lib/sandbox.ts` | Context compression [1, 12] |
| Config caching (60s in-memory) | `src/lib/config.ts` | Cache everything [2] |
| Snapshot-based sandbox boot | `src/lib/sandbox.ts` | Infrastructure optimization |
| PII masking | Various agents | Security guardrails [1] |

---

## High-Impact Opportunities

### A. Semantic Response Caching

**Impact:** 40-70% latency reduction for repeat/similar queries
**Effort:** Medium
**Research basis:** SCALM [10], LLMBridge [8], articles [1, 2]

Users frequently ask similar analytical questions. A semantic cache using vector similarity (cosine > 0.92) could serve cached responses directly, bypassing both LLM and sandbox execution. Cache keyed by query embedding, stored in KV with TTL-based invalidation (15 min for analytics data).

**Implementation target:** `src/agent/insights-analyzer/agent.ts` — cache check before `executeSandbox()`

---

### B. OpenAI Prompt Prefix Caching

**Impact:** 50% reduction in input token costs (on cache hit)
**Effort:** Low
**Research basis:** Prompt caching [1], OpenAI documentation

OpenAI automatically caches identical prompt prefixes. Ensure the static system prompt portion (DB schema, chart API docs, rules) is a fixed, deterministic prefix. Only the user's query and conversation context should vary. This happens automatically — we just need to ensure prompt structure is stable.

**Implementation target:** `src/agent/insights-analyzer/agent.ts` — restructure system prompt for stable prefix

---

### C. Dynamic Model Routing (Experience-Based)

**Impact:** 50-80% cost reduction, 30-70% latency reduction
**Effort:** Medium
**Research basis:** EvoRoute [9], articles [1, 2]

Classify query complexity (`simple` | `moderate` | `complex`) and route to the cheapest model that historically succeeds for that class. Log outcomes to continuously refine routing decisions.

**Implementation target:** `src/lib/ai.ts`, `src/agent/insights-analyzer/agent.ts`

---

### D. YAML Schema Format

**Impact:** ~20% token reduction in schema representation
**Effort:** Low
**Research basis:** Data format optimization [1]

Convert `DB_SCHEMA_ANALYTICS` from SQL DDL notation to YAML. Rzayev's analysis shows YAML is the most token-efficient structured format.

**Implementation target:** `src/services/analytics.service.ts`

---

## Medium-Impact Opportunities

### E. Result-Aware Sandbox Sizing

Classify sandbox tasks as `query-only` vs `analysis` and allocate resources accordingly. Simple queries skip chart injection and get shorter timeouts.

### F. Meta-Tool Bundling (AWO Pattern)

Identify recurring tool call sequences in chat-manager and bundle them into composite tools that execute deterministically without intermediate LLM reasoning.

### G. Streaming Partial Results

Stream progress updates during sandbox execution ("analyzing...", "queried X rows", "generating charts...") to reduce perceived latency. Frontend already supports `useEventStream()`.

### H. Conversation History Compression

Apply Selective Context [12] principles to prune older conversation turns before sending to LLM. Summarize earlier turns instead of sending full text.

---

## Not Applicable / Lower Priority

| Technique | Why Not Applicable |
|-----------|-------------------|
| Model quantization (INT8/INT4) | We use API-hosted models (OpenAI), not self-hosted |
| vLLM/SGLang runtimes | API-based inference, not self-hosted |
| Speculative decoding | Requires self-hosted models with draft model access |
| GPU scheduling (FREESH, Autellix) | Not running our own GPU infrastructure |
| Fine-tuning | High effort, requires training data pipeline; defer until query volume justifies |

---

## Recommended Priority Order

| # | Optimization | Effort | Impact | Confidence |
|---|-------------|--------|--------|------------|
| 1 | OpenAI Prompt Prefix Caching (B) | Low | High (50% input token savings) | Very High |
| 2 | Semantic Response Caching (A) | Medium | Very High (40-70% latency) | High |
| 3 | Dynamic Model Routing (C) | Medium | High (50-80% cost) | High |
| 4 | YAML Schema Format (D) | Low | Moderate (~20% tokens) | Medium |
| 5 | Result-Aware Sandbox Sizing (E) | Low | Moderate (~20-40% sandbox) | Medium |
| 6 | Meta-Tool Bundling (F) | Medium | Moderate (11-15% fewer calls) | High |
| 7 | Streaming Partial Results (G) | High | UX (perceived latency) | High |

---

## References

1. Rzayev, R. (2026). "Optimization strategies for agentic systems." *Medium*.
2. Jacob, R. (2025). "How I Cut Agentic Workflow Latency by 3-5x." *HackerNoon*.
3. Mishra, M. (2025). "How to Reduce Agent Latency in Agentic AI Systems." *Medium*.
4. Ye et al. (2025). "Speculative Actions: A Lossless Framework for Faster Agentic Systems." *arXiv:2510.04371*.
5. Abuzakuk et al. (2026). "Optimizing Agentic Workflows using Meta-tools." *arXiv:2601.22037*.
6. Luo et al. (2025). "Autellix: An Efficient Serving Engine for LLM Agents." *arXiv:2502.13965*.
7. Kulkarni et al. (2026). "Optimizing FaaS Platforms for MCP-enabled Agentic Workflows." *arXiv:2601.14735*.
8. Martin et al. (2024). "LLMBridge: Reducing Costs to Access LLMs in a Prompt-Centric Internet." *arXiv:2410.11857*.
9. Zhang et al. (2026). "EvoRoute: Experience-Driven Self-Routing LLM Agent Systems." *arXiv:2601.02695*.
10. Li et al. (2024). "SCALM: Towards Semantic Caching for Automated Chat Services with Large Language Models." *arXiv:2406.00025*.
11. Pan et al. (2024). "LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression." *arXiv:2403.12968*. Findings of ACL 2024.
12. Li et al. (2023). "Compressing Context to Enhance Inference Efficiency of Large Language Models." *arXiv:2310.06201*. EMNLP 2023.
13. Xu et al. (2023). "RECOMP: Improving Retrieval-Augmented LMs with Compression and Selective Augmentation." *arXiv:2310.04408*.
