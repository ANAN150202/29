import { z } from 'zod';
import { SUITS } from '@shared/types';

const roomCode = z
  .string()
  .trim()
  .min(4)
  .max(8)
  .regex(/^[A-Za-z0-9]+$/);
const nickname = z.string().trim().min(1).max(32);
const actionId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const seat = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const settingsSchema = z
  .object({
    rulesetId: z.string().max(32),
    reverseTrumpEnabled: z.boolean(),
    allowSpectators: z.boolean(),
    turnTimeLimitSec: z.number().int().min(0).max(300),
    biddingStyle: z.enum(['duel', 'open']),
  })
  .partial()
  .strict();

const gameBase = z.object({ roomCode, actionId, seq: z.number().int().nonnegative() });

export const schemas = {
  'room:create': z.object({ nickname, settings: settingsSchema.optional() }),
  'room:join': z.object({
    roomCode,
    nickname,
    sessionToken: z.string().min(16).max(128).optional(),
    asSpectator: z.boolean().optional(),
  }),
  'room:leave': z.object({ roomCode }),
  'room:ready': z.object({ roomCode, ready: z.boolean() }),
  'room:switchSeat': z.object({ roomCode, seat }),
  'room:updateSettings': z.object({ roomCode, settings: settingsSchema }),
  'room:backToLobby': z.object({ roomCode }),
  'room:addBot': z.object({ roomCode, seat: seat.optional() }),
  'room:removeBot': z.object({ roomCode, seat }),
  'room:playVsComputer': z.object({ nickname, settings: settingsSchema.optional() }),
  'game:start': z.object({ roomCode }),
  'game:sync': z.object({ roomCode }),
  'game:bid': gameBase.extend({ amount: z.number().int().min(0).max(100) }),
  'game:pass': gameBase,
  'game:chooseTrump': gameBase.extend({ suit: z.enum(SUITS), reverse: z.boolean() }),
  'game:revealTrump': gameBase,
  'game:declarePair': gameBase,
  'game:playCard': gameBase.extend({ cardId: z.string().min(3).max(16) }),
  'game:double': gameBase.extend({ stage: z.enum(['double', 'redouble', 'set']) }),
  'game:declineDouble': gameBase,
  'game:declareSingle': gameBase,
  'game:skipSingle': gameBase,
  'game:nextRound': gameBase,
  'game:rematch': gameBase,
} as const;
