import { Card } from './Card';
import { Modal } from './Modal';
import type { Card as CardT, Rank } from '@shared/types';

const order: Rank[] = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
const mk = (rank: Rank): CardT => ({ id: `hearts-${rank}`, suit: 'hearts', rank });

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="HOW TO PLAY" onClose={onClose} className="modal--wide">
      <div className="rules prose">
        <h3>The basics</h3>
        <p>
          29 is played by four players in two partnerships — partners sit opposite each other. A 32-card deck is used
          (7 to Ace in every suit). Play moves to the player on your right.
        </p>

        <h3>Card ranks &amp; points</h3>
        <div className="rules__ranks">
          {order.map((r) => (
            <Card key={r} card={mk(r)} size="sm" />
          ))}
        </div>
        <p>
          Strongest → weakest: <b>J 9 A 10 K Q 8 7</b>. Points: Jack 3, Nine 2, Ace 1, Ten 1 — 28 points in the deck.
          The gold pips on a card show its points.
        </p>

        <h3>Deal &amp; bidding</h3>
        <p>
          Everyone gets 4 cards, then players bid the number of card points their team will win (16–28).{' '}
          <b>Duel bidding</b> (default): only two players bid at a time. The first two after the dealer start; the
          later player must bid <b>higher</b>, while the earlier player may <b>stay</b> at the same number. Whoever
          passes is out, and the next player in order challenges the survivor — partners duel too. The last player
          standing wins the bid. If everyone passes, the cards are reshuffled and the next player deals.{' '}
          <b>Open bidding</b> (room option): everyone raises in turn instead.
        </p>

        <h3>Trump</h3>
        <p>
          The highest bidder picks a trump suit — <b>Normal</b> or <b>Reverse</b> — after seeing only their first 4 cards.
          Then everyone gets 4 more. In <b>Classic</b> rules the trump is secret: when you cannot follow suit you may{' '}
          <b>Call for Trump</b>, which reveals it to everyone; you must then play a trump if you hold one. Trumps have no
          power until revealed. In <b>Open Trump</b> rules it is announced immediately.
        </p>

        <h3>Reverse Trump</h3>
        <p>
          With Reverse Trump the rank order <b>inside the trump suit</b> is flipped: <b>7 8 Q K 10 A 9 J</b> (7 is the
          highest trump, J the lowest). Any trump still beats any non-trump, other suits keep their normal order, and card
          points never change. The indicator shows <code>REVERSE TRUMP: HEARTS</code> instead of{' '}
          <code>TRUMP: HEARTS</code>.
        </p>

        <h3>Playing</h3>
        <p>
          You must follow the lead suit if you can. The highest trump wins the trick; if no trump was played, the highest
          card of the lead suit wins. The trick winner leads next. Eight tricks per round.
        </p>

        <h3>Pair (Classic rules)</h3>
        <p>
          After trump is revealed, a player holding the King and Queen of trump whose team has won a trick since the
          reveal can declare the pair: the bidding team's target drops by 4 (min 16) if they declare it, or rises by 4
          (max 28) if the opponents do.
        </p>

        <h3>Scoring</h3>
        <p>
          If the bidding team takes at least its target in card points it gains 1 game point, otherwise it loses 1. The
          first team to reach <b>+6</b> wins the match — a team that falls to <b>−6</b> loses.
        </p>
      </div>
    </Modal>
  );
}
