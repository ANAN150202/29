import { Flame, X } from 'lucide-react';
import { useState } from 'react';
import type { DoublingCall, GameView, PublicPlayer, Seat } from '@shared/types';
import type { GameSocketApi } from '../game/useGameSocket';
import { TurnTimer } from './TurnTimer';

const CALL: Record<DoublingCall, { label: string; mult: number; who: string }> = {
  double: { label: 'DOUBLE', mult: 2, who: 'opponents' },
  redouble: { label: 'REDOUBLE', mult: 4, who: "bidder's team" },
  set: { label: 'SET', mult: 6, who: 'opponents' },
};

/** Double → Redouble → Set, decided on the first four cards only. */
export function DoublingPanel({ game, seats, actions }: { game: GameView; seats: (PublicPlayer | null)[]; actions: GameSocketApi['actions'] }) {
  const d = game.doubling;
  const [busy, setBusy] = useState(false);
  const name = (s: Seat) => seats[s]?.nickname ?? `Seat ${s + 1}`;
  if (!d.stage) return null;
  const call = CALL[d.stage];
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  return (
    <div className="action-panel doubling">
      <p className="pixel-heading pixel-heading--sm">
        {call.label}? · BID {game.contract?.bid} · NOW ×{d.multiplier}
      </p>
      {d.calls.length > 0 && (
        <p className="doubling__calls">
          {d.calls.map((c, i) => (
            <span key={i} className={`call-chip call-chip--${c.call}`}>
              {name(c.seat)}: {CALL[c.call].label}
            </span>
          ))}
        </p>
      )}
      {d.canCall ? (
        <>
          <p className="muted small center">
            {d.stage === 'redouble'
              ? 'The opponents doubled. Confident your team makes the contract?'
              : d.stage === 'set'
                ? 'They redoubled! Say SET if you are sure they will fail.'
                : 'Think the bidder will fail? You have only seen 4 cards.'}{' '}
            Win/lose becomes <b className="gold">±{call.mult}</b>.
          </p>
          <div className="doubling__buttons">
            <button type="button" className={`btn btn--call btn--call-${d.stage}`} disabled={busy} onClick={() => act(() => actions.double(d.stage!))}>
              <Flame size={16} /> {call.label} ×{call.mult}
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => act(() => actions.declineDouble())}>
              <X size={16} /> NO
            </button>
          </div>
        </>
      ) : (
        <p className="muted blink-slow">
          Waiting for the {call.who} ({d.pending.map(name).join(', ')}) to decide…
        </p>
      )}
      <TurnTimer leftMs={game.turnTimeLeftMs} totalMs={game.turnTimeLimitMs} resetKey={`${d.stage}`} tickSound={d.canCall} />
    </div>
  );
}
