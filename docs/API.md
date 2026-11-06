# MEGA AUCTION V1 â€” API & SERVER ACTIONS SPECIFICATION

> **Status:** APPROVED
> **Version:** 1.1
> **Date:** 2026-08-10

---

## 1. Server Actions Architecture

All application mutations use Next.js Server Actions with Zod validation, authenticated session checks, and PostgreSQL RPC invocation.

### 1.1 Auth Actions (`actions/auth.ts`)
- `signUp(formData)`
- `signIn(formData)`
- `signOut()`
- `updateProfile(formData)`

### 1.2 Room Actions (`actions/rooms.ts`)
- `createRoom(data)`
- `joinRoom(code)`
- `leaveRoom(roomId)`
- `updateRoomSettings(roomId, settings)`
- `assignTeam(roomId, userId, teamId)`
- `kickParticipant(roomId, userId)`

### 1.3 Auction Actions (`actions/auction.ts`)
- `startAuction(roomId)`
- `pauseAuction(auctionId)`
- `resumeAuction(auctionId)`
- `endAuction(auctionId)`
- `getAuctionState(roomId)` â€” Full state recovery endpoint

### 1.4 Bid Actions (`actions/bids.ts`)
- `placeBid(auctionId, amount, requestId)` â€” Requires client-generated `requestId` UUID

### 1.5 Player Actions (`actions/players.ts`)
- `createPlayerSet(data)`
- `addPlayer(playerSetId, data)`
- `updatePlayer(playerId, data)`
- `deletePlayer(playerId)`
- `importPlayers(playerSetId, csvData)`

---

## 2. API Routes
- `POST /api/heartbeat` â€” Authenticated client presence, timer check, and bot bid trigger.
- `GET /api/health` â€” Health check endpoint.
