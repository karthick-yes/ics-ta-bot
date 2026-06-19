# SocraticAI

Scaffolded LLM tutoring system for undergraduate CS education — structured constraints over prohibition.

---

## The Problem

CS students with unrestricted LLM access default to shallow dependency: vague prompts, uncritical copying, zero reflection. Institutions respond by banning AI entirely or leaving the floodgates open. Neither works. Bans become unenforceable. Open access becomes a crutch. The skill that actually matters — learning to *reason with* AI — never gets built.

## What This Does

SocraticAI treats the LLM as a Socratic tutor, not an answer engine. It forces a "think-articulate-reflect" loop before any feedback is delivered. Daily caps prevent overuse. RAG grounds responses in actual course materials. Reflection prompts are mandatory. Escalation to human instructors preserves full context.

Students progress from "my code doesn't work" to "I implemented recursion correctly, but I'm unsure how my base case terminates" within 2–3 weeks.

---

## Architecture

```
Student Input
     │
     ▼
┌─────────────────────────────────────┐
│  Validation Layer                   │
│  Checks completeness & relevance    │
│                                     │
│  Guided Prompt Framework            │
│  Structured question stages         │
│                                     │
│  RAG-Based Retrieval                │
│  Fetches course-grounded materials  │
│                                     │
│  AI Feedback                        │
│  Context-aligned response           │
│                                     │
│  Reflection Prompt                  │
│  Summarizes learning/next steps     │
└─────────────────────────────────────┘
     │
     ▼
  Resolved?
    /    \
  Yes      No
   │        │
   ▼        ▼
Log +      Escalate to Instructor
Metrics    (full chat history preserved)
   │
   ▼
Instructor Dashboard / Observability
(Prometheus logs, analytics, guardrails)
```

---

## Core Constraints

| Guardrail | Implementation | Why |
|-----------|----------------|-----|
| **Daily query limit** | 8 queries per student, enforced at system level | Prevents over-reliance, forces deliberate formulation |
| **Structured input** | Must submit current understanding + attempted solutions + relevant code before receiving feedback | Blocks vague help-seeking |
| **Multi-stage prompting** | (a) describe approach & confusion, (b) explain prior attempts, (c) identify specific concept needing clarification | Few-shot exemplars reduce unproductive queries |
| **RAG course grounding** | Semantically indexed knowledge base of lectures, assignments, textbook excerpts | Minimizes hallucinations, ensures curricular alignment |
| **Mandatory reflection** | "What did you learn?" / "What remains unclear?" / outline next steps | 75%+ of students produce substantive reflections |
| **Escalation with context** | Full conversation history preserved when human intervention needed | Instructors get reasoning trail, not just the final error |

---

## System Components

- **Authentication service** — student identity & query-budget tracking
- **Feedback collection & handling** — structured input validation, prompt orchestration
- **Vector retrieval service** — RAG pipeline over course materials
- **Admin dashboard** — real-time engagement monitoring, escalation queue
- **Redis** — real-time data storage with periodic persistence for post-analysis
- **Prometheus** — query volume, reflection quality, escalation frequency logging

---

## Technical Safeguards

- **Input sanitization** — prevents prompt injection attacks
- **Context management** — handles long conversations without state drift
- **Adversarial testing** — continuous stress-testing of system prompts against circumvention attempts
- **Dynamic feedback tagging** — auto-labels interaction types for analytics

---

## Deployment Results

| Metric | Result |
|--------|--------|
| Course | CS-1102 Intro to Computer Science, Ashoka University |
| Observation period | 3 weeks |
| Students producing substantive reflections | >75% |
| Linguistic shift | "My code doesn't work" → precise decomposition-oriented inquiries |
| Instructor office-hour load | Fewer repetitive low-cognitive questions |
| Student self-report | "Training me to ask better questions" |

---

## Vulnerabilities Found

Summer controlled prompt-injection experiments exposed weaknesses in:
- Retrieval layer semantic boundaries
- Conversation-state handling under adversarial input

Both informed ongoing improvements in sanitation protocols and adversarial testing coverage.

---

## Paper

**SocraticAI: Transforming LLMs into Guided CS Tutors Through Scaffolded Interaction**  
Karthik Sunil, [co-author] — Ashoka University  
arXiv:2512.03501 | December 2025

---

## For Instructors Replicating This

**Do:**
- Iteratively stress-test constraints against circumvention
- Onboard students with explicit modeling of productive interactions
- Monitor usage data continuously to adjust limits and prompts
- Use reflection data for formative assessment

**Don't:**
- Underestimate guardrail complexity — prompt injection defense is non-trivial
- Skip semantic retrieval curation — stale course materials degrade grounding
- Ignore operational costs — Redis, Prometheus, vector DBs need maintenance
- Assume one-size-fits-all — adapt query limits to course difficulty

---

## The Long View

The goal isn't AI tutoring. It's AI literacy as a core computational skill. Students who learn to structure queries, interrogate responses, and reflect on gaps are learning how to work with the tools they'll use professionally. The constraint architecture is the pedagogy.
