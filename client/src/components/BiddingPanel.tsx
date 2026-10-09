import { Gavel, Minus, Plus, Swords } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GameView, PublicPlayer, Seat } from '@shared/types';
import type { GameSocketApi } from '../game/useGameSocket';

export function BiddingPanel({ game, seats, actions }: { game: GameView; seats: (PublicPlayer | null)[]; actions: GameSocketApi['actions'] }) {
  const b = game.bidding;
  const myTurn = game.turn === game.mySeat && game.mySeat !== null;
  const [amount, setAmount] = useState(b.nextMinBid);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAmount(b.nextMinBid), [b.nextMinBid]);
  const name = (s: Seat | null) => (s === null ? '' : seats[s]?.nickname ?? `Seat ${s + 1}`);
  const you = (s: Seat | null) => (s !== null && s === game.mySeat ? ' (you)' : '');
  const canBid = b.nextMinBid <= b.maxBid;
  const isDuel = b.style === 'duel';
  const raiseMin = b.highestBid === null ? b.minBid : b.highestBid + 1;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return (
    <div className="action-panel bidding">
      <div className="bidding__status">
        <Gavel size={16} className="gold" />
        {b.highestBid !== null ? (
          <span>
            HIGH BID <b className="gold">{b.highestBid}</b> by {name(b.highestBidder)}
          </span>
        ) : (
          <span>NO BIDS YET · MIN {b.minBid}</span>
        )}
      </div>

      {isDuel && b.holder !== null && (
        <div className="duel" aria-label="Bidding duel">
          <span className={`duel__side ${game.turn === b.holder ? 'is-turn' : ''}`} title="Has priority: may stay at the same number">
            {name(b.holder)}
            {you(b.holder)} <small>{b.challenger !== null ? 'CAN STAY' : 'ALONE'}</small>
          </span>
          {b.challenger !== null && (
            <>
              <Swords size={16} className="gold" aria-label="versus" />
              <span className={`duel__side ${game.turn === b.challenger ? 'is-turn' : ''}`} title="Must bid higher">
                {name(b.challenger)}
                {you(b.challenger)} <small>MUST GO HIGHER</small>
              </span>
            </>
          )}
          {b.waiting.length > 0 && <span className="duel__waiting">next: {b.waiting.map(name).join(', ')}</span>}
        </div>
      )}

      {myTurn ? (
        <div className="bidding__controls">
          {b.canStay && (
            <button type="button" className="btn btn--green" disabled={busy} onClick={() => act(() => actions.bid(b.highestBid!))}>
              STAY {b.highestBid}
            </button>
          )}
          {(() => {
            const min = b.canStay ? raiseMin : b.nextMinBid;
            if (min > b.maxBid) return null;
            const value = Math.max(amount, min);
            return (
              <>
                <div className="stepper" role="group" aria-label="Bid amount">
                  <button type="button" className="btn btn--icon" onClick={() => setAmount(Math.max(min, value - 1))} disabled={value <= min} aria-label="Lower bid">
                    <Minus size={16} />
                  </button>
                  <output className="stepper__value" aria-live="polite">
                    {value}
                  </output>
                  <button type="button" className="btn btn--icon" onClick={() => setAmount(Math.min(b.maxBid, value + 1))} disabled={value >= b.maxBid} aria-label="Raise bid">
                    <Plus size={16} />
                  </button>
                </div>
                <button type="button" className="btn btn--gold" disabled={busy || !canBid} onClick={() => act(() => actions.bid(value))}>
                  BID {value}
                </button>
              </>
            );
          })()}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || b.mustBid}
            title={b.mustBid ? 'Everyone else passed — the dealer must bid.' : undefined}
            onClick={() => act(() => actions.pass())}
          >
            PASS
          </button>
        </div>
      ) : (
        <p className="muted blink-slow">{game.mySeat === null ? 'Bidding in progress…' : `Waiting for ${name(game.turn)} to bid…`}</p>
      )}
      {b.history.length > 0 && (
        <ol className="bid-history" aria-label="Bid history">
          {b.history.map((h, i) => (
            <li key={i} className={h.bid === null ? 'is-pass' : ''}>
              {name(h.seat)}: {h.bid === null ? 'pass' : h.stay ? `stay ${h.bid}` : h.bid}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
