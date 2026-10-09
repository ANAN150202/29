import { DoorOpen, Eye, Play, RotateCcw, Trophy } from 'lucide-react';
import type { GameView, PublicPlayer, TeamId } from '@shared/types';
import { TEAM_NAME, trumpText } from '../game/labels';
import type { GameSocketApi } from '../game/useGameSocket';
import { Modal } from './Modal';

export function ResultsPanel({
  game,
  seats,
  isHost,
  actions,
  onHide,
}: {
  game: GameView;
  seats: (PublicPlayer | null)[];
  isHost: boolean;
  actions: GameSocketApi['actions'];
  onHide: () => void;
}) {
  const r = game.roundResult;
  if (!r) return null;
  const matchOver = game.phase === 'matchEnd';
  const bidderTeam = r.contract.team;
  const roundWinner: TeamId = r.success ? bidderTeam : ((1 - bidderTeam) as TeamId);
  const teamPlayers = (t: TeamId) => `${seats[t]?.nickname ?? '—'} & ${seats[t + 2]?.nickname ?? '—'}`;
  const myTeam = game.mySeat !== null ? game.mySeat % 2 : null;
  const iWon = matchOver && myTeam === game.matchWinner;

  return (
    <Modal title={matchOver ? 'MATCH OVER' : `ROUND ${r.round} RESULT`} className={`results ${matchOver ? 'results--match' : ''}`}>
      {matchOver && (
        <div className={`victory team-${game.matchWinner}`}>
          <div className="victory__sparkles" aria-hidden>
            {Array.from({ length: 18 }, (_, i) => (
              <i key={i} style={{ ['--i' as string]: i }} />
            ))}
          </div>
          <Trophy size={40} className="gold" aria-hidden />
          <p className="pixel-heading">TEAM {TEAM_NAME[game.matchWinner!].toUpperCase()} WINS!</p>
          <p>{teamPlayers(game.matchWinner!)}</p>
          {myTeam !== null && <p className="pixel-heading pixel-heading--sm">{iWon ? 'VICTORY!' : 'GOOD GAME!'}</p>}
        </div>
      )}
      <div className={`result-banner ${r.success ? 'is-success' : 'is-fail'}`}>
        <b>{seats[r.contract.bidder]?.nickname}</b> ({TEAM_NAME[bidderTeam]}) bid {r.contract.bid}
        {r.contract.target !== r.contract.bid && <> → target {r.contract.target}</>} and{' '}
        <b>{r.success ? 'MADE IT' : 'WENT DOWN'}</b> with {r.bidderTeamPoints} points.
      </div>
      <p className="center">
        <span className={`trump-chip ${r.reverseTrump ? 'trump-chip--reverse' : ''}`}>{trumpText(r.trumpSuit, r.reverseTrump)}</span>
      </p>
      <table className="results__table">
        <thead>
          <tr>
            <th>TEAM</th>
            <th>TRICKS</th>
            <th>CARD PTS</th>
            <th>ROUND</th>
            <th>MATCH</th>
          </tr>
        </thead>
        <tbody>
          {([0, 1] as TeamId[]).map((t) => (
            <tr key={t} className={`team-${t} ${roundWinner === t ? 'is-winner' : ''}`}>
              <th scope="row">
                <span className={`team-dot team-dot--${t}`} /> {TEAM_NAME[t].toUpperCase()}
                <small>{teamPlayers(t)}</small>
              </th>
              <td>{r.tricksWon[t]}</td>
              <td>{r.cardPoints[t]}</td>
              <td>{r.gamePointsDelta[t] > 0 ? `+${r.gamePointsDelta[t]}` : r.gamePointsDelta[t] || '—'}</td>
              <td className="score-big">{r.matchScore[t] > 0 ? `+${r.matchScore[t]}` : r.matchScore[t]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="results__actions">
        {game.mySeat !== null && !matchOver && (
          <button type="button" className="btn btn--gold" onClick={() => actions.nextRound()}>
            <Play size={16} /> NEXT ROUND
          </button>
        )}
        {game.mySeat !== null && matchOver && (
          <button type="button" className="btn btn--gold" onClick={() => actions.rematch()}>
            <RotateCcw size={16} /> PLAY AGAIN
          </button>
        )}
        {isHost && (
          <button type="button" className="btn" onClick={() => actions.backToLobby()}>
            <DoorOpen size={16} /> RETURN TO LOBBY
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onHide}>
          <Eye size={16} /> VIEW TABLE
        </button>
      </div>
      {!isHost && matchOver && <p className="muted small center">Only the host can return everyone to the lobby.</p>}
    </Modal>
  );
}
