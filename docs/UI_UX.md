# MEGA AUCTION V1 â€” UI / UX DESIGN SPECIFICATION

> **Status:** APPROVED
> **Version:** 1.0
> **Date:** 2026-08-10

---

## 1. Visual Identity & Dual Systems

### 1.1 Auth & Dashboard Systems
- Clean, modern, card-based interface built with shadcn/ui and Tailwind CSS.
- Dark theme default, high usability, crisp form components.

### 1.2 Auction Room System
- Premium IPL-style dark visual identity.
- Deep navy/slate background palette (`#0F172A`, `#1E293B`).
- Vibrant team accent colors.
- JetBrains Mono typography for timer, currency, and numerical figures.
- Live broadcast broadcast aesthetic with clear visual status indicators.

---

## 2. Key Screen Breakdown
1. **Landing Page (`/`):** Hero section, feature cards, CTA buttons.
2. **Auth (`/login`, `/signup`):** Accessible, validated form cards.
3. **Dashboard (`/dashboard`):** Active rooms summary, player set management shortcuts.
4. **Player Management (`/players`):** Grid/table views, CSV import modal with row-level error feedback.
5. **Room Lobby (`/rooms/[roomId]/lobby`):** Live participant list, team assignment drag-and-drop, room settings drawer.
6. **Auction Room (`/auction/[roomId]`):** Three-panel layout (Player Card, Bid Controls & Timer, Teams Overview & Activity Feed).
7. **Statistics (`/rooms/[roomId]/statistics`):** Interactive Recharts spending breakdown, squad matrices, and CSV export.
8. **Admin Panel (`/admin`):** Room management, user controls, and system audit logs.
