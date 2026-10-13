"use strict";
// src/lib/auction/human-auction-manager-types.ts
//
// Human Auction Manager — Phase 1: CONTRACTS ONLY
//
// PURPOSE:
//   Defines the data contracts for the future centralized Human Auction Manager
//   decision pipeline:
//
//     PlayerContext
//       → PlayerQualityResult          "How good is he?"
//       → PlayerMarketValueResult      "What is he generally worth?"
//       → TeamValueResult              "What is he worth to MY team?"
//       → MaximumBidResult             "What is the most I can rationally pay?"
//       → HumanAuctionDecision         "What should I do right now?"
//
// PHASE 1 BOUNDARY:
//   - Types only. No runtime logic, no formulas, no thresholds, no ₹ values.
//   - NOT wired into server-bot-engine / bot-q-engine / bot-tactical-engine.
//   - All imports are `import type` → erased at compile time, so this module
//     adds zero runtime dependencies and cannot create import cycles.
//
// MONETARY UNIT:
//   All monetary fields are in LAKHS (₹ L), matching V3Team.purse,
//   V3Player.base_price and the existing bid ladder (e.g. 1400 = ₹14 Cr).
//
// STAGE ISOLATION RULES (enforced structurally by the stage contexts below):
//   - Market Value never sees team need, purse, opponents or future targets.
//   - Team Value never sees purse limits or opponents.
//   - Maximum Bid never sees opponents.
//   - Opponent information only enters at the Decision stage. It changes how
//     the bot behaves AROUND its valuation, never the valuation itself.
Object.defineProperty(exports, "__esModule", { value: true });
