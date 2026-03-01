# AGENTS.md

## Scope of Application
- This specification applies to all directories and files in this repository.
- If a subdirectory has a new `AGENTS.md`, the lower-level specification can only supplement, not weaken, the mandatory constraints of this file.

## Project Goals and Coding Principles
- This project is positioned as a brand-new system, with `uniformity` and `simplicity` as the highest priorities.
- Do not introduce redundant branches, compatibility layers, dual-track logic, or temporary patches under the excuse of "compatibility with old code/old behavior."
- New features and refactoring should prioritize consistency, maintainability, and readability over historical baggage.
- Prohibit the use of any `any` type; types must be explicitly defined.

## File and Modularization Requirements
- Large files must be split into clear modules, organized by responsibility boundaries.
- If a single file handles multiple types of responsibilities (e.g., UI, state, data requests, transformation logic mixed together), it must be split.
- Common capabilities should be extracted into reusable modules to avoid copy-pasting.
- Naming must reflect responsibilities, and the directory structure should support quick navigation and reading.

## Data Security and High-Risk Operations
- Any operation that may lead to data `deletion`, `loss`, `overwriting`, `structural changes`, or `irreversible modifications` must obtain explicit user consent before execution.
- Without explicit consent, only read-only analysis, solution design, and risk explanation are allowed; implementation is not permitted.
- Scenarios involving databases, batch file rewrites, migration scripts, cleanup scripts, and overwrite operations are all treated as high-risk.
- However, harmless operations such as running tests and builds are allowed.
- Tests, builds, lint, and other non-destructive commands can be executed.

## Thinking and Decision-Making Methods
- All solutions must adopt first principles: first clarify objectives, constraints, and facts, then derive implementation paths.
- Do not make decisions based on "convention" or "history"; you must explain core assumptions and trade-off rationale.
- Implementations should pursue minimal necessary complexity, avoiding ineffective abstractions and over-design.

## Command and Git Operation Restrictions
- Only `Git read-only queries` are allowed; no other commands are permitted.
- Allowed Git read-only operations include status and history queries, such as: `git status`, `git log`, `git diff`, `git show`, `git branch` (read-only usage).
- Any operations that change Git state or history require explicit user consent, including but not limited to: `commit`, `push`, `pull`, `merge`, `rebase`, `cherry-pick`, `reset`, `checkout` (modifying usage), creating/deleting branches, and tagging.
- Without consent, code rewriting, staging, committing, syncing, rollback, or history rewriting are not allowed.
- Tests, builds, lint, and other testing commands can be executed.

## Do Not Mask Any Issues
- Do not implement any unnecessary fallback logic, especially logic that may hide problems. Unless the user permits, do not automatically switch to a new model when one is unavailable, skip errors when code fails, provide default values when none exist, or fabricate fake data.
- System execution must follow the principle of explicit failure and zero implicit fallback: strictly prohibit silent error skipping, implicit configuration fallback, or automatic model degradation, ensuring all unexpected behavior crashes in place and is reported truthfully.

## Dare to Reasonably Challenge the User and Understand Their True Needs
- Ask questions to understand what I truly need (not just what I say).
- The user may not understand the code well, and their technical understanding may not be as good as yours.
- What the user says is for reference, not absolute truth. If something doesn't make sense, challenge my assumptions.

## Testing Specifications

For detailed specifications, see [`agent/testing.md`](agent/testing.md). The following are mandatory core constraints:

- New features or modified functionality logic must be tested. New features must include tests. If modifying a file requires modifying test files, they must be modified together to ensure 100% test coverage follows.
- Changing worker logic / fixing bugs / adding routes or task types → must write or update tests.
- Bug fixes must include new regression tests, with the `it()` name reflecting the bug scenario.
- Assertions must check specific values (DB field values, function parameters, return values). Do not use only `toHaveBeenCalled()`.
- Prohibit "self-answered questions": mocking return X and then asserting X without going through any business logic.
