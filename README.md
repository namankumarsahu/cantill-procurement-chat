# Corvo procurement workspace

A policy-driven PR-to-PO take-home project for Cantill.ai.

Current status: **phase 1, kit review and design**. There is no runnable web app
yet. Read [the review and proposed schema](docs/PHASE_1.md),
[business decisions](DECISIONS.md), and [tool disclosure](APPROACH.md).

## Local kit

Extract the task ZIP contents into `kit_data/`, with `master_data/`, `contracts/`,
`pr_batches/`, and the three source PDFs directly beneath it. This folder and its
extracted text are ignored. Do not commit datasets, PDFs, `.env`, or credentials.

## Planned implementation

TypeScript monorepo: pure `engine/`, Express `server/`, React `web/`, PostgreSQL.
Phase 2 adds migrations, imports, policy validation and the hand-authored v5 seed.
Later phases add the engine/API, supplier ranking, policy version workflow,
requester/buyer UI and audit, contract extraction, and deployment.

The eventual commands are `docker compose up`, `npm run seed -- ./kit_data`,
and `npm test`; **they are not implemented yet**. This README will gain executable
setup instructions alongside the code. Hosted URL: pending deployment.
