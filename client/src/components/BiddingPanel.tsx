import { Gavel, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GameView, PublicPlayer } from '@shared/types';
import type { GameSocketApi } from '../game/useGameSocket';

export function BiddingPanel({ game, seats, actions }: { game: GameView; seats: (PublicPlayer | null)[]; actions: GameSocketApi['actions'] }) {
  const b = game.bidding;
  const myTurn = game.turn === game.mySeat && game.mySeat !== null;
  const [amount, setAmount] = useState(b.nextMinBid);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAmount(b.nextMinBid), [b.nextMinBid]);
  const highName = b.highestBidder !== null ? seats[b.highestBidder]?.nickname : null;
  const turnName = game.turn !== null ? seats[game.turn]?.nickname : '';
  const canBid = b.nextMinBid <= b.maxBid;

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
            HIGH BID <b className="gold">{b.highestBid}</b> by {highName}
          </span>
        ) : (
          <span>NO BIDS YET · MIN {b.minBid}</span>
        )}
      </div>
      {myTurn ? (
        <div className="bidding__controls">
          <div className="stepper" role="group" aria-label="Bid amount">
            <button type="button" className="btn btn--icon" onClick={() => setAmount((a) => Math.max(b.nextMinBid, a - 1))} disabled={amount <= b.nextMinBid} aria-label="Lower bid">
              <Minus size={16} />
            </button>
            <output className="stepper__value" aria-live="polite">
              {amount}
            </output>
            <button type="button" className="btn btn--icon" onClick={() => setAmount((a) => Math.min(b.maxBid, a + 1))} disabled={amount >= b.maxBid} aria-label="Raise bid">
              <Plus size={16} />
            </button>
          </div>
          <button type="button" className="btn btn--gold" disabled={busy || !canBid} onClick={() => act(() => actions.bid(amount))}>
            BID {amount}
          </button>
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
        <p className="muted blink-slow">{game.mySeat === null ? 'Bidding in progress…' : `Waiting for ${turnName} to bid…`}</p>
      )}
      {b.history.length > 0 && (
        <ol className="bid-history" aria-label="Bid history">
          {b.history.map((h, i) => (
            <li key={i} className={h.bid === null ? 'is-pass' : ''}>
              {seats[h.seat]?.nickname ?? `Seat ${h.seat + 1}`}: {h.bid ?? 'pass'}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
