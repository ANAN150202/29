# 29 Royale — Rules Reference

29 has many regional variations. This document describes exactly what 29 Royale implements.
Every configurable choice lives in [`server/src/config/rulesConfig.ts`](../server/src/config/rulesConfig.ts);
the engine never hard-codes a regional rule.

## Fixed rules (define the game)

| Topic | Rule |
|---|---|
| Deck | 32 cards: 7, 8, 9, 10, J, Q, K, A in ♣ ♦ ♥ ♠ |
| Card points | J = 3, 9 = 2, A = 1, 10 = 1, K/Q/8/7 = 0 → **28 points** in the deck |
| Rank order | Strongest → weakest: **J 9 A 10 K Q 8 7** |
| Teams | Seats 0 + 2 (Team **Red**) vs seats 1 + 3 (Team **Blue**). Partners sit opposite each other. |
| Turn order | Play passes to `seat + 1`. The UI draws this anticlockwise: the player on your right acts after you. |
| Dealer | Random seat for the first round, then rotates one seat per round (including redeals). |
| Deal | 4 cards each (starting from the seat after the dealer), then bidding, then trump, then 4 more each. |
| Following suit | You must follow the lead suit if you can. Otherwise you may play any card (see the trump-reveal exception). |
| Tricks | 8 per round. The trick winner leads the next trick. |

Card points, tricks won, and game points (the match score) are kept separately in state and code.

## Bidding

| Setting | Default | Config key |
|---|---|---|
| Lowest bid | 16 | `minBid` |
| Highest bid | 28 | `maxBid` |
| Increment | +1 | `bidIncrement` |
| Auction format | **Duel** (room option: Open) | `biddingStyle` / room setting `biddingStyle` |
| Everyone passes | Cards reshuffled, deal passes to the next player | `allPassAction: 'redeal'` (alt: `'dealerForced'`) |

### Duel bidding (default, traditional)

Players speak in order starting after the dealer: **P1, P2, P3, P4** (P4 is the dealer).

1. Only **two players bid at a time**. The duel starts with **P1 (holder) against P2 (challenger)**. P1 speaks first.
2. The **challenger must bid higher** than the current bid.
3. The **holder has priority** and may **stay**, matching the current bid, or raise.
4. Whoever **passes is out** for the round. The survivor keeps (or gains) priority and becomes the holder against the **next player in order**, who must go higher.
5. This repeats until every player has had a chance. The last player standing wins the bid at its final amount. Partners duel each other exactly like opponents.

Details:

* **P1 may pass without bidding.** P2 and P3 then duel, and P2 holds priority (P2 speaks first, since there is no bid yet).
* If everyone before the last player passed without bidding, the **last player bids or passes alone**. If all four pass, the cards are reshuffled and the next player deals.
* **Staying at 28 is allowed.** No challenger can go higher, so the remaining players pass automatically and the holder wins at 28.

Example (P1 = you, P2 = right opponent, P3 = your partner, P4 = left opponent):

| # | Action | Duel |
|---|---|---|
| 1 | P1 bids 16 | P1 vs P2 |
| 2 | P2 bids 17 (must exceed) | |
| 3 | P1 **stays** 17 | |
| 4 | P2 bids 18 | |
| 5 | P1 passes (out) | P2 vs P3 |
| 6 | P3 must bid 19+, P2 may stay… | if P2 passes: P3 vs P4 |

### Open bidding (room option)

Everyone bids in turn order. Each bid must beat the current high bid by at least the increment, and a player who passes is out. The auction ends when only the highest bidder is left, or immediately on a bid of 28.

## Trump selection

After the auction, the winning bidder chooses, **after seeing only their first four cards**:

1. a trump suit, and
2. a mode: **Normal Trump** or **Reverse Trump** (only if the room enabled Reverse Trump).

State keeps these separately: `trumpSuit: 'hearts'`, `reverseTrump: true`.

### Concealed trump (`trumpConcealed: true`, the classic ruleset)

* Only the bidder sees the trump. All other clients receive `suit: null` and see **TRUMP: HIDDEN**.
* Until it is revealed, trump-suit cards have **no trumping power**. They are ordinary off-suit cards.
* On their turn, a player who **cannot follow the lead suit** may **Call for Trump**. The trump suit and mode are then revealed to everyone.
* `mustPlayTrumpAfterReveal: true`: after calling, that player must play a trump if they hold one; if they hold none, they may play any card.
* Trump counts for a trick if it is revealed at any point before the trick is collected, including trumps played earlier in the same trick.
* Nobody is forced to reveal. If trump is never revealed, no trick in that round is won by trump.
* At round end the trump is shown to everyone.

### Open trump (`open` ruleset)

The trump suit and mode are announced to everyone as soon as they are chosen.

## Reverse Trump

Reverse Trump changes **trick-winning priority only**:

| | Normal | Reverse (default scope `trumpSuitOnly`) |
|---|---|---|
| Trump-suit order | J 9 A 10 K Q 8 7 | **7 8 Q K 10 A 9 J** |
| Trump vs non-trump | any trump beats any non-trump | **unchanged**: any trump (even the reversed J) beats any non-trump |
| Other suits | J 9 A 10 K Q 8 7 | **unchanged** |
| Card points | J=3, 9=2, A=1, 10=1 | **unchanged** |
| Bidding values | 16–28 | **unchanged** |

The UI shows `TRUMP: HEARTS` or `REVERSE TRUMP: HEARTS` (a purple, flashing badge with an inverted suit icon).

**Regional variant:** the `fullReverse` ruleset sets `reverseTrumpScope: 'allSuits'`, which inverts the order of **every** suit when Reverse Trump is chosen. It is isolated in the config and is not the default.

The single source of truth for card strength is
`getEffectiveCardStrength(card, leadSuit, trumpSuit, reverseTrump, scope)` in
[`server/src/game/rules.ts`](../server/src/game/rules.ts):

* active trump-suit card → `200 + rank strength` (reversed when `reverseTrump`)
* lead-suit card → `100 + rank strength` (reversed only with scope `allSuits`)
* any other card → `0` (can never win)

`trumpSuit` is passed as `null` while a concealed trump is unrevealed.

## Double / Redouble / Set

| Setting | Default | Config key |
|---|---|---|
| Enabled | yes | `doublingEnabled` |
| Multipliers (none / double / redouble / set) | 1 / 2 / 4 / 6 | `doublingMultipliers` |
| Decision window | 12 s | `declarationWindowMs` |

* Decided **after trump is chosen and before the last four cards are dealt**: everyone has seen only their first four cards.
* **Double:** either **opponent** of the bidder may double. Points at stake become ×2.
* **Redouble:** after a double, either player of the **bidder's team** may redouble (×4).
* **Set:** after a redouble, either **opponent** may say Set (×6).
* Each step closes when both eligible players say No, or when the window times out. A late click for a step that is no longer open is rejected.
* Scoring: the bidding team gains or loses `1 × multiplier`: ±1, ±2, ±4, ±6. With the default target of 6, a failed Set ends the match.

## Single Hand

| Setting | Default | Config key |
|---|---|---|
| Enabled | yes | `singleHandEnabled` |
| Points | ±3 | `singleHandPoints` |

* After **all eight cards are dealt**, before the first card is played, **any player** may declare a Single Hand. Everyone gets a short window to declare or skip; it closes when all four skip or time runs out.
* The declarer's **partner sits out** (their cards are not played), the **declarer leads**, and there is **no trump**: the highest card of the suit led wins. Tricks have three cards.
* The declarer must win **all 8 tricks**: **+3**. As soon as an opponent wins a trick the round ends: **−3**.
* A Single Hand **replaces the contract and any Double/Redouble/Set** for that round.
* **Conceivably-lose rule:** you may not declare with a hand that cannot possibly lose a trick. Checked suit by suit: if the declarer holds `n` cards of a suit and `u = 8 − n` are unseen, an opponent holding all `u` can keep its highest unseen card until the declarer's `min(u, n)`-th lead. The hand can be caught if that card outranks the declarer's `min(u, n)`-th highest card in that suit. If no suit can be caught, the hand is invincible and the declaration is refused.

## Pair (King + Queen of trump), enabled in `classic`

| Setting | Default |
|---|---|
| `pairEnabled` | `true` (classic), `false` (open) |
| `pairValue` | 4 |
| `pairMinTarget` / `pairMaxTarget` | 16 / 28 |

* A pair can be declared only after trump is revealed, by a player holding **both** K and Q of trump, whose team has won at least one trick since the reveal (the reveal trick counts). One pair per round.
* Declared by the bidding team: target −4 (never below 16). Declared by the defenders: target +4 (never above 28).
* Reverse Trump does not affect the pair. It is always K + Q.

## Scoring

1. **Card points**: each team sums the points in the tricks it won (0–28, both teams together always 28).
2. **Contract**: the bidding team succeeds if its card points ≥ the target (the bid, adjusted by any pair).
3. **Game points**: success → bidding team **+1** (`gamePointsForWin`); failure → bidding team **−1** (`gamePointsForLoss`). Defenders' game score does not change.
4. **Match**: a team that reaches **+6** wins; a team that falls to **−6** loses (`targetScore`).

## Rules not included by default (documented, not silently invented)

These exist in some regions but are **not** part of any shipped ruleset. Adding one means adding a config flag plus engine support and tests:

* Annulling a hand for special holdings (e.g. no point cards, four jacks).
* Restrictions on the bidder leading trump before it is revealed.
* Partnership bidding conventions or bidding the "seventh card" as trump.

Ties cannot occur: card points always total 28 and the contract compares against a single target.

## Timers & automation (room layer, not rules)

* **Turn timer** (room setting: off / 20 / 30 / 45 / 60 / 90 s). When it expires the server plays a safe default: pass (or bid the minimum when forced), choose the longest suit as **normal** trump, or play the lowest-value legal card. It never calls for trump.
* **Vacated seats** (a player left, or did not reconnect within the grace period) are auto-played the same way after a short delay until someone takes over the seat.
