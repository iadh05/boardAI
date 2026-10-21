# Agent architecture — V2 (draft, 2026-10-21)

**Status: draft to shape with the owner.** Starts from [V1](architecture-v1.md) and fixes its two gaps: a **main agent** that owns the conversation, and **explicit flows**.

## The main agent: the only one that talks to you

```
You ⇄ Main agent ──▶ Architect ──▶ specialists (and their sub-agents)
          │              └──▶ Planner, Critic
          └──▶ Scribe, memory
```

| The main agent does | It does not |
|---|---|
| Understands what you want (the flow), in your language | Design: that's the Architect's job |
| Asks back when it's unclear, and challenges assumptions (it absorbs the Interviewer) | Call specialists directly: it asks the Architect |
| Keeps the thread across turns: what was asked, decided, rejected | Invent facts: answers about the design come from the Architect's findings |
| Explains results in plain words, short or deep as you want | Change the board itself: only proposals, accepted by you |
| Hands Accept / Reject to the Scribe and memory | |

The router of V1 becomes the main agent's first step (classifying the flow), in code where possible.

## The flows

| # | You say | Flow | Who works |
|---|---|---|---|
| F1 | "What is a CDN?" / "Why Kafka here?" | **Question:** answer, no board change | Main (+ Researcher for "best practice?") |
| F2 | "Review my design" | **Review:** findings → one proposal | Main → Architect → specialists → Critic → Main |
| F3 | "Design me an Uber Eats" | **Draft:** ask the needs first, then a whole draft | Main (asks) → Planner → Architect → Critic → Main |
| F4 | "Add a cache in front of Postgres" | **Change request:** do what's asked, check it, no full review | Main → Architect → (Data / Cost if relevant) → Main |
| F5 | "Is it secure?" / "How much will it cost?" | **Deep dive:** one specialist | Main → Architect → that specialist → Main |
| F6 | Accept / Reject | **Decision:** record it, update memory | Main → Scribe → memory |
| F7 | "No, keep RabbitMQ" | **Disagreement:** weigh your reason, change view or explain the trade-off | Main → Architect (with memory) → Main |
| F8 | "What did we decide about the queue?" | **Recall:** from the decision log | Main → Scribe / memory |

## Open questions for the owner

1. Is the main agent a separate LLM call, or the Architect's "voice"? (Separate = clearer roles, one more call per turn.)
2. Which flows ship first? Suggestion: F2 (today's review), F6, F1, then F4, F5, F3.
3. Does the main agent answer F1 alone, or always pass through the Architect?
4. Where does the Interviewer's checklist (users, peaks, budget, cloud, skills) live — the main agent's prompt, or a tool?
