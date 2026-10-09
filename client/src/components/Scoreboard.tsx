import type { GameView, PublicPlayer, TeamId } from '@shared/types';
import { TEAM_NAME } from '../game/labels';

export function Scoreboard({ game, seats }: { game: GameView; seats: (PublicPlayer | null)[] }) {
  const teamNames = (t: TeamId) =>
    [t, t + 2]
      .map((s) => seats[s]?.nickname ?? '—')
      .join(' & ');
  const myTeam = game.mySeat !== null ? ((game.mySeat % 2) as TeamId) : null;
  const target = game.targetScore;
  return (
    <section className="pixel-panel scoreboard" aria-label="Scoreboard">
      <h3 className="pixel-heading pixel-heading--sm">SCORE</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">TEAM</th>
            <th scope="col" title="Match game points">GAME</th>
            <th scope="col" title="Tricks won this round">TRICKS</th>
            <th scope="col" title="Card points this round">PTS</th>
          </tr>
        </thead>
        <tbody>
          {([0, 1] as TeamId[]).map((t) => (
            <tr key={t} className={`team-${t} ${myTeam === t ? 'is-mine' : ''}`}>
              <th scope="row">
                <span className={`team-dot team-dot--${t}`} /> {TEAM_NAME[t].toUpperCase()}
                <small>{teamNames(t)}</small>
              </th>
              <td className="score-big">{game.matchScore[t] > 0 ? `+${game.matchScore[t]}` : game.matchScore[t]}</td>
              <td>{game.tricksWon[t]}</td>
              <td>{game.cardPoints[t]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="score-track" aria-hidden>
        {Array.from({ length: target * 2 + 1 }, (_, i) => i - target).map((v) => (
          <span
            key={v}
            className={`score-track__cell ${v === 0 ? 'is-zero' : ''} ${game.matchScore[0] === v ? 'has-red' : ''} ${game.matchScore[1] === v ? 'has-blue' : ''}`}
          />
        ))}
      </div>
      <p className="muted small">First to +{target} wins · −{target} loses</p>
      {game.contract && (
        <p className="contract-line">
          <b>{seats[game.contract.bidder]?.nickname ?? 'Bidder'}</b> ({TEAM_NAME[game.contract.team]}) needs{' '}
          <b className="gold">{game.contract.target}</b>
          {game.contract.target !== game.contract.bid && <> (bid {game.contract.bid})</>} · has{' '}
          <b>{game.cardPoints[game.contract.team]}</b>
        </p>
      )}
      {game.pair && (
        <p className="muted small">
          Pair declared by {seats[game.pair.seat]?.nickname} ({game.pair.adjustment > 0 ? '+' : ''}
          {game.pair.adjustment})
        </p>
      )}
    </section>
  );
}
