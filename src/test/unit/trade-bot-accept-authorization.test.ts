import { describe, expect, it } from 'vitest';

/** Mirrors the ACCEPT authorization predicate proposed for public.v3_respond_trade. */
function mayAcceptTrade(params: {
  status: string;
  isReceiverParticipant: boolean;
  isRoomHost: boolean;
  receiverIsBot: boolean;
  isProposerParticipant: boolean;
}): boolean {
  if (params.status !== 'PENDING') return false;
  return params.isReceiverParticipant || (
    params.isRoomHost && params.receiverIsBot && !params.isProposerParticipant
  );
}

describe('bot trade ACCEPT authorization contract', () => {
  it('allows a human receiver participant, including the room host, to accept a bot-proposed offer', () => {
    expect(mayAcceptTrade({
      status: 'PENDING',
      isReceiverParticipant: true,
      isRoomHost: true,
      receiverIsBot: false,
      isProposerParticipant: false,
    })).toBe(true);
  });

  it('allows the authenticated room host to accept on behalf of a bot receiver', () => {
    expect(mayAcceptTrade({
      status: 'PENDING',
      isReceiverParticipant: false,
      isRoomHost: true,
      receiverIsBot: true,
      isProposerParticipant: false,
    })).toBe(true);
  });

  it('does not let the room host accept for a bot when their own team proposed the trade', () => {
    expect(mayAcceptTrade({
      status: 'PENDING',
      isReceiverParticipant: false,
      isRoomHost: true,
      receiverIsBot: true,
      isProposerParticipant: true,
    })).toBe(false);
  });

  it('does not let a host-only override accept on behalf of a human receiver', () => {
    expect(mayAcceptTrade({
      status: 'PENDING',
      isReceiverParticipant: false,
      isRoomHost: true,
      receiverIsBot: false,
      isProposerParticipant: false,
    })).toBe(false);
  });

  it('does not let a non-host accept for a bot without receiver participation', () => {
    expect(mayAcceptTrade({
      status: 'PENDING',
      isReceiverParticipant: false,
      isRoomHost: false,
      receiverIsBot: true,
      isProposerParticipant: false,
    })).toBe(false);
  });

  it('rejects ACCEPT authorization before role checks when the trade is not pending', () => {
    expect(mayAcceptTrade({
      status: 'REJECTED',
      isReceiverParticipant: false,
      isRoomHost: true,
      receiverIsBot: true,
      isProposerParticipant: false,
    })).toBe(false);
  });

  it('preserves direct receiver-participant authorization for human teams', () => {
    expect(mayAcceptTrade({
      status: 'PENDING',
      isReceiverParticipant: true,
      isRoomHost: false,
      receiverIsBot: false,
      isProposerParticipant: false,
    })).toBe(true);
  });
});
