import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isMuted, onMuteChange, setMuted, unlockAudio } from '../game/sound';

export function MuteButton() {
  const [muted, setState] = useState(isMuted());
  useEffect(() => onMuteChange(setState), []);
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        unlockAudio();
        setMuted(!muted);
      }}
      aria-label={muted ? 'Turn sound on' : 'Mute sound'}
      aria-pressed={muted}
      title={muted ? 'Sound off' : 'Sound on'}
    >
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
    </button>
  );
}
