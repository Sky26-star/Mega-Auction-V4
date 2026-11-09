# MEGA AUCTION V1 â€” PRODUCT REQUIREMENTS DOCUMENT (PRD)

> **Status:** APPROVED
> **Version:** 1.0
> **Date:** 2026-08-10

---

## 1. Executive Summary
Mega Auction is a real-time, multiplayer IPL-style sports auction web application. It enables fans, friends, and gaming communities to host, manage, and participate in high-stakes player auctions with live real-time bidding, automated bots, purse management, and comprehensive statistics.

---

## 2. Product Objectives
- **Real-Time Multiplayer Experience:** Sub-second bid propagation and live timer countdown across all connected participants.
- **Server Authority:** Absolute backend control over purses, bid serialization, squad validation, and auction state machine.
- **Bot Automation:** Server-side bots fill unclaimed teams to enable auctions with any number of human players (min 2 teams total).
- **IPL Auction Rules:** Mandatory reserve, overseas player caps, squad size limits, and 2nd round for unsold players.
- **Zero-Setup UX:** Instant room creation with shareable 6-character room codes.

---

## 3. Core Target Audience
- Cricket and sports enthusiasts hosting private IPL-style auctions.
- Fantasy sports leagues conducting live player drafts.
- Gaming communities looking for interactive, competitive multiplayer auction experiences.

---

## 4. Key Functional Requirements (Version 1)
1. **User Authentication & Profiles:** Supabase Auth with custom profiles, avatar, and admin capabilities.
2. **Player Management:** Custom player sets, CRUD operations, CSV bulk import, category & role attributes.
3. **Room & Lobby System:** Room creation via code, custom settings (timer, purse, squad size, bid increment, player order), participant list, team assignment.
4. **Auction Engine & Realtime Bidding:** Synchronized lot presentation, real-time bid controls, client heartbeat + pg_cron backstop timer, automatic bot bidding via identical server pipeline.
5. **Unsold Player Pool:** Automatic 2nd round pass for unsold players at 50% base price.
6. **Statistics & Analytics:** Team spending charts, squad composition breakdown, CSV/JSON export.
7. **Notifications & Logs:** Ephemeral toast notifications and persistent activity log.
8. **Admin Panel:** Monitoring active rooms, user management, and audit log inspection.

---

## 5. Explicit Non-Goals (Version 2 Exclusions)
- Tournament match simulation & fixtures
- Points tables & playoff brackets
- Fantasy scoring engines
- Voice/video chat integration
- Native mobile apps (V1 is responsive web)

---

## 6. Success Metrics
- **Bid Latency:** < 500ms server processing time for valid bids.
- **Realtime Sync:** < 200ms message propagation to all room subscribers.
- **Uptime & Stability:** Zero data corruption or purse miscalculation under concurrent bidding.
