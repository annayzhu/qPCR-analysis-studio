# Domain Docs

This repository uses a single-context domain-document layout.

## Required reading

Before modifying the codebase:

1. Read the root `CONTEXT.md`.
2. Read the relevant decisions under `docs/adr/`.
3. Use the domain terms defined in `CONTEXT.md` in specifications, issue titles, tests, interfaces, and documentation.
4. Do not silently contradict an ADR; identify the conflict and explain why the decision should be reconsidered.

## Layout

- `CONTEXT.md`: shared qPCR domain glossary and system concepts.
- `docs/adr/`: architecture decisions shared by the application and packages.
- `packages/*`: implementation modules that share the same domain context.

A package should receive a separate context only if it later develops an independent domain model with materially different terminology or invariants.
