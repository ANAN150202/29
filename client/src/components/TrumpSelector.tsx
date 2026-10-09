import { ArrowDownUp, ArrowUpDown, Check } from 'lucide-react';
import { useState } from 'react';
import { SUITS, type GameView, type PublicPlayer, type Suit } from '@shared/types';
import { isRed, SUIT_NAME, trumpText } from '../game/labels';
import type { GameSocketApi } from '../game/useGameSocket';
import { PixelSuit } from './PixelSuit';

export function TrumpSelector({ game, seats, actions }: { game: GameView; seats: (PublicPlayer | null)[]; actions: GameSocketApi['actions'] }) {
  const isBidder = game.contract?.bidder === game.mySeat && game.mySeat !== null;
  const [suit, setSuit] = useState<Suit | null>(null);
  const [reverse, setReverse] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isBidder) {
    const name = game.contract ? seats[game.contract.bidder]?.nickname : '';
    return (
      <div className="action-panel trump-select trump-select--waiting">
        <p className="pixel-heading pixel-heading--sm blink-slow">{name} IS CHOOSING TRUMP…</p>
        <p className="muted">Contract: {game.contract?.bid} points</p>
      </div>
    );
  }

  const counts = Object.fromEntries(SUITS.map((s) => [s, game.myHand.filter((c) => c.suit === s).length])) as Record<Suit, number>;

  return (
    <div className="action-panel trump-select">
      <p className="pixel-heading pixel-heading--sm">CHOOSE TRUMP · YOU BID {game.contract!.bid}</p>
      <div className="trump-select__suits" role="radiogroup" aria-label="Trump suit">
        {SUITS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={suit === s}
            className={`suit-btn ${isRed(s) ? 'is-red' : 'is-black'} ${suit === s ? 'is-selected' : ''}`}
            onClick={() => setSuit(s)}
          >
            <PixelSuit suit={s} size={28} />
            <span>{SUIT_NAME[s].toUpperCase()}</span>
            <small>{counts[s]} in hand</small>
          </button>
        ))}
      </div>
      <div className="mode-toggle" role="radiogroup" aria-label="Trump mode">
        <button type="button" role="radio" aria-checked={!reverse} className={`mode-btn ${!reverse ? 'is-selected' : ''}`} onClick={() => setReverse(false)}>
          <ArrowUpDown size={14} /> NORMAL TRUMP
          <small>J 9 A 10 K Q 8 7</small>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={reverse}
          className={`mode-btn mode-btn--reverse ${reverse ? 'is-selected' : ''}`}
          disabled={!game.reverseTrumpAllowed}
          title={game.reverseTrumpAllowed ? undefined : 'Reverse Trump is disabled in this room'}
          onClick={() => setReverse(true)}
        >
          <ArrowDownUp size={14} /> REVERSE TRUMP
          <small>7 8 Q K 10 A 9 J</small>
        </button>
      </div>
      <button
        type="button"
        className="btn btn--gold"
        disabled={!suit || busy}
        onClick={async () => {
          setBusy(true);
          await actions.chooseTrump(suit!, reverse);
          setBusy(false);
        }}
      >
        <Check size={16} /> {suit ? `CONFIRM ${trumpText(suit, reverse)}` : 'PICK A SUIT'}
      </button>
    </div>
  );
}
