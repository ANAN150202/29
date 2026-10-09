import { SkipForward, User } from 'lucide-react';
import { useState } from 'react';
import type { GameView, PublicPlayer, Seat } from '@shared/types';
import type { GameSocketApi } from '../game/useGameSocket';
import { TurnTimer } from './TurnTimer';

/** After all 8 cards are dealt, anyone may go for a Single Hand. */
export function SingleHandPanel({ game, seats, actions }: { game: GameView; seats: (PublicPlayer | null)[]; actions: GameSocketApi['actions'] }) {
  const s = game.single;
  const [busy, setBusy] = useState(false);
  const name = (x: Seat) => seats[x]?.nickname ?? `Seat ${x + 1}`;
  const mine = game.mySeat !== null && s.pending.includes(game.mySeat);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  return (
    <div className="action-panel single-panel">
      <p className="pixel-heading pixel-heading--sm">SINGLE HAND?</p>
      {mine ? (
        <>
          <p className="muted small center">
            Play alone against both opponents — your partner sits out, you lead, <b>no trump</b>. Win all 8 tricks for{' '}
            <b className="gold">+{s.points}</b>; lose one and it's <b>−{s.points}</b>.
          </p>
          {s.blockedReason && <p className="form-error small center">{s.blockedReason}</p>}
          <div className="doubling__buttons">
            <button type="button" className="btn btn--call btn--call-single" disabled={busy || !s.canDeclare} onClick={() => act(() => actions.declareSingle())}>
              <User size={16} /> DECLARE SINGLE
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => act(() => actions.skipSingle())}>
              <SkipForward size={16} /> SKIP
            </button>
          </div>
        </>
      ) : (
        <p className="muted blink-slow">
          {s.pending.length ? `Waiting for ${s.pending.map(name).join(', ')}…` : 'Starting play…'}
        </p>
      )}
      <TurnTimer leftMs={game.turnTimeLeftMs} totalMs={game.turnTimeLimitMs} resetKey="single" tickSound={mine} />
    </div>
  );
}
