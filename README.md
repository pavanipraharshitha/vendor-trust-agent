# LedgerMind

### A memory-augmented Accounts Payable agent powered by Hindsight Cloud.

LedgerMind checks invoices against current AP controls **and remembers what happened with the vendor before**.

> **Automate confidence. Escalate uncertainty. Block high-risk changes.**

## What problem does it solve?

Traditional AP automation often treats every invoice as a new decision.

LedgerMind adds **persistent vendor memory** so past payments, exceptions, resolutions, and verified bank details can influence today's decision.

## How does Hindsight fit?

Hindsight is LedgerMind's long-term memory.

**Recall** relevant vendor history before a decision → **Decide** using current evidence + memory → **Retain** important events for future decisions.

## 4 Demo Scenarios

| Scenario | Decision |
|---|---|
| **Cold Start** — no vendor history | HUMAN REVIEW |
| **Recurring Exception** — previous discrepancy recalled | EXCEPTION |
| **Learned Vendor** — established history + clean controls | AUTO-APPROVE |
| **Bank-Account Surprise** — previous beneficiary vs new account | PAYMENT BLOCKED |

## Architecture

```text
React UI
   ↓
Express Backend
   ├── Invoice / PO / GRN
   └── Hindsight Cloud
          Recall ↕ Retain
   ↓
AP Decision Engine
   ↓
Approve / Exception / Review / Block
## Run

```bash
npm install
npm run dev
