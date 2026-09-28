# LedgerMind — Accounts Payable Agent

LedgerMind is a memory-enabled AP decision agent built for the Hindsight hackathon. The default workspace is designed around two judge-visible surfaces: **Agent Trace** and **Agent Decision**.

## Core workflow

Invoice → Purchase Order → Goods Receipt → Hindsight Recall → Risk Evaluation → Controlled Decision → Hindsight Retain

## Four behaviors

1. **Cold-start** — a supplier with no prior AP history is routed to human verification.
2. **Recurring exception** — a known discrepancy recalls a previous resolution.
3. **Bank-account surprise** — fourteen historical payments to one beneficiary establish a baseline; a first-time beneficiary change triggers a payment hold.
4. **Learned vendor** — a clean invoice from an established supplier can be auto-approved when current controls pass.

## Data

The project uses realistic **synthetic** AP data: 25 vendors, 100 invoices, purchase orders, goods receipts, vendor history and audit events.

## Hindsight

The server uses the official TypeScript Hindsight client for `recall` and `retain`. Historical vendor context is kept separate from current decision/audit events, and the UI displays only a focused set of relevant memories.

## Run

Create `.env` from `.env.example` and add your Hindsight Cloud API key. Then:

```bash
npm install
npm run dev
```

Do not commit `.env` or API keys.
