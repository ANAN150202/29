import { ArrowDownUp, EyeOff, HelpCircle } from 'lucide-react';
import type { GameView } from '@shared/types';
import { isRed, trumpText } from '../game/labels';
import { PixelSuit } from './PixelSuit';

export function TrumpIndicator({ game, compact = false }: { game: GameView; compact?: boolean }) {
  const { trump } = game;
  if (!game.contract || game.phase === 'bidding' || game.phase === 'trumpSelection') {
    return (
      <div className="trump-ind trump-ind--none">
        <HelpCircle size={14} /> {game.phase === 'trumpSelection' ? 'CHOOSING TRUMP…' : 'TRUMP: —'}
      </div>
    );
  }
  if (trump.hiddenFromMe || !trump.suit) {
    return (
      <div className="trump-ind trump-ind--hidden" title="The bidder has chosen trump secretly. It is revealed when someone cannot follow suit and calls for it.">
        <EyeOff size={14} /> TRUMP: HIDDEN
      </div>
    );
  }
  const reverse = !!trump.reverse;
  return (
    <div
      className={`trump-ind ${reverse ? 'trump-ind--reverse' : 'trump-ind--normal'} ${isRed(trump.suit) ? 'is-red' : 'is-black'}`}
      title={reverse ? 'Reverse Trump: in the trump suit 7 is highest and J is lowest.' : 'Normal trump order: J 9 A 10 K Q 8 7.'}
    >
      {reverse && <ArrowDownUp size={14} aria-hidden />}
      <PixelSuit suit={trump.suit} size={16} className="trump-ind__suit" />
      <span>{trumpText(trump.suit, reverse)}</span>
      {!trump.revealed && !compact && <span className="trump-ind__secret">ONLY YOU KNOW</span>}
    </div>
  );
}
