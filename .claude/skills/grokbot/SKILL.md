---
name: grokbot
description: What Grokbot (xAI's Grok Bot) is and what it can actually do — named cloud agents with their own persistent computer, connectors and MCP, approvals, saved skills and schedules. Use when the user mentions Grokbot, Grok Bot, or "my bot", asks whether to hand a task to it, asks it to run commands or reach something on their own machine, or asks how to set one up. Ryan uses it daily.
---

# Grokbot (xAI "Grok Bot")

An agent app from xAI. You create **named bots**, give each one a job, connect
them to tools, and message them like colleagues. They keep working after you
close the app and come back when they need input or approval.

Runs on Grok 4.6. The macOS, Windows and iOS apps are thin clients.

## The thing that trips people up

**The bot's computer is not your computer.**

Each account gets a persistent cloud Linux VM with its own browser, filesystem
and terminal. When a bot "runs a command" or "opens a file", that is happening
on the cloud machine, not on the Mac in front of you.

Consequences worth stating before someone plans around it:

- **It cannot reach `localhost` on your machine.** A dev server on
  `localhost:3000`, a database on `5432`, Ollama on `127.0.0.1:11434` — none of
  these are reachable from the bot's VM. Neither are local MCP servers (stdio
  or localhost HTTP).
- **MCP has to be remote**: HTTP/SSE endpoints that are publicly reachable over
  HTTPS, or connectors from the catalogue.
- **There is an opt-in local-computer capability.** A bot can run commands on
  your actual machine when that capability is enabled and you approve it under
  your local-computer policy. It is off unless turned on, and worth leaving off
  unless a task genuinely needs files or commands on the machine in front of
  you. *(Enablement details unverified — see Confidence below.)*
- **All your bots share one cloud computer** — files, browser sessions, logins.
  The docs are explicit that they do not get separate security boundaries from
  each other. Treat anything one bot can reach as reachable by all of them.

## What it is good at

- **Long-running work.** It keeps going after you close the app, so jobs that
  take hours suit it.
- **Tool work through connectors and plugins** — Gmail, Google Drive, Google
  Calendar, Notion, Slack, support and analytics platforms, plus remote MCP.
- **Persistent memory per named bot**: files, browser logins, preferences and
  how you like things done, carried across sessions rather than reset each task.
- **Saved skills and schedules.** Walk a bot through a multi-step path once, it
  can save that path as a skill and re-run it on a schedule.
- **Multi-bot handoff.** Bots pass work between each other, sharing the machine
  and the context.

## Approvals

Actions can be gated on approval — sending messages, publishing, deleting data,
purchases, changing production systems. Sensitive actions are also assessed by
an independent review model ("Auto Review"). Set these before handing over
anything outbound or destructive, not after.

## Choosing between Grokbot and a local agent

| The task needs | Use |
| --- | --- |
| A service on your own machine, a local dev server, local Ollama, a local repo checkout | A local agent (e.g. Claude Code in a terminal), or Grokbot with local-computer access explicitly enabled |
| Cloud SaaS, email, calendar, docs, browsing, anything long-running | Grokbot |
| Files that must not leave the machine | Local agent only — the bot's VM is off-machine by definition |

For ScriptToCast specifically: the private path talks to Ollama on
`127.0.0.1`, so a cloud-side Grokbot cannot run or test it. That needs
something running on the Mac itself.

## Pricing

Reported at $2 per million input tokens and $6 per million output tokens on
Grok 4.6. Check current pricing before quoting it.

## Confidence

Gathered September 2026 from xAI documentation summaries and secondary
write-ups. **`x.ai` and `docs.x.ai` were unreachable from the environment where
this was compiled** (blocked by an egress proxy), so nothing here was read from
the primary source directly.

Treat as solid: the cloud-VM architecture, no localhost or local-MCP reach,
shared computer across bots, connectors/MCP, approvals, saved skills,
scheduling, per-bot memory.

Verify before relying on: exact steps to enable local-computer access, current
pricing, and the connector list. Primary pages to check —
`docs.x.ai/grok-bot/overview`, `docs.x.ai/grok-bot/computer-and-apps`,
`docs.x.ai/grok-bot/faq`.
