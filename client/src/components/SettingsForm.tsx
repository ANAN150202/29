import type { RoomSettings } from '@shared/types';
import { useRulesets } from '../game/useRulesets';

export const TURN_TIMES = [0, 20, 30, 45, 60, 90];

export function SettingsForm({
  value,
  onChange,
  disabled,
}: {
  value: RoomSettings;
  onChange: (patch: Partial<RoomSettings>) => void;
  disabled?: boolean;
}) {
  const rulesets = useRulesets();
  const current = rulesets.find((r) => r.id === value.rulesetId);
  return (
    <fieldset className="settings" disabled={disabled}>
      <label className="field">
        <span className="field__label">RULESET</span>
        <select value={value.rulesetId} onChange={(e) => onChange({ rulesetId: e.target.value })}>
          {rulesets.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {current?.description && <small className="field__hint">{current.description}</small>}
      </label>
      <label className="field">
        <span className="field__label">BIDDING</span>
        <select value={value.biddingStyle} onChange={(e) => onChange({ biddingStyle: e.target.value as RoomSettings['biddingStyle'] })}>
          <option value="duel">Duel — two at a time, earlier player can stay</option>
          <option value="open">Open — everyone raises in turn</option>
        </select>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={value.reverseTrumpEnabled}
          disabled={current ? !current.reverseTrumpSupported : false}
          onChange={(e) => onChange({ reverseTrumpEnabled: e.target.checked })}
        />
        <span className="toggle__box" aria-hidden />
        <span>
          <b>Reverse Trump</b> <small>— bidder may flip the trump suit's rank order</small>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={value.allowSpectators} onChange={(e) => onChange({ allowSpectators: e.target.checked })} />
        <span className="toggle__box" aria-hidden />
        <span>
          <b>Allow spectators</b>
        </span>
      </label>
      <label className="field">
        <span className="field__label">TURN TIMER</span>
        <select value={value.turnTimeLimitSec} onChange={(e) => onChange({ turnTimeLimitSec: Number(e.target.value) })}>
          {TURN_TIMES.map((t) => (
            <option key={t} value={t}>
              {t === 0 ? 'Off' : `${t} seconds`}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
