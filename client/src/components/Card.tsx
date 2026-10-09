import type { Card as CardT } from '@shared/types';
import { isRed, RANK_NAME, RANK_POINTS, SUIT_NAME } from '../game/labels';
import { PixelSuit } from './PixelSuit';

interface CardProps {
  card?: CardT;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  playable?: boolean;
  disabled?: boolean;
  selected?: boolean;
  highlight?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function Card({ card, faceDown, size = 'md', playable, disabled, selected, highlight, onClick, className = '', style }: CardProps) {
  const classes = [
    'card',
    `card--${size}`,
    faceDown || !card ? 'card--back' : isRed(card.suit) ? 'card--red' : 'card--black',
    playable && 'card--playable',
    disabled && 'card--disabled',
    selected && 'card--selected',
    highlight && 'card--highlight',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (faceDown || !card) {
    return <div className={classes} style={style} aria-label="Face-down card" />;
  }

  const points = RANK_POINTS[card.rank];
  const label = `${RANK_NAME[card.rank]} of ${SUIT_NAME[card.suit]}${points ? `, ${points} point${points > 1 ? 's' : ''}` : ''}`;
  const content = (
    <>
      <span className="card__corner card__corner--tl">
        <span className="card__rank">{card.rank}</span>
        <PixelSuit suit={card.suit} size={size === 'sm' ? 8 : 10} />
      </span>
      <PixelSuit suit={card.suit} size={size === 'lg' ? 40 : size === 'sm' ? 18 : 30} className="card__pip" />
      {points > 0 && (
        <span className="card__points" aria-hidden>
          {Array.from({ length: points }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      )}
      <span className="card__corner card__corner--br">
        <span className="card__rank">{card.rank}</span>
        <PixelSuit suit={card.suit} size={size === 'sm' ? 8 : 10} />
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} style={style} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={selected}>
        {content}
      </button>
    );
  }
  return (
    <div className={classes} style={style} role="img" aria-label={label}>
      {content}
    </div>
  );
}
