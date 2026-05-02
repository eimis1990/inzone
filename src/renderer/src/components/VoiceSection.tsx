/**
 * Voice tab — Siri-style animated orb up top, status pill + mic button
 * underneath, plus the latest transcript line. The orb's animation
 * keys off the conversation status: idle = slow breathe, listening =
 * gentle pulse, speaking = lively oscillation, error = red shake.
 */

import { useVoiceAgent } from '../voice/useVoiceAgent';
import { MicIcon, StopIcon } from './icons';

export function VoiceSection() {
  const { status, isConfigured, error, lastMessage, toggle } =
    useVoiceAgent();
  const isLive = status === 'listening' || status === 'speaking';

  return (
    <div className="voice-tab">
      <div className={`voice-orb voice-orb-${status}`} aria-hidden>
        <div className="voice-orb-aura" />
        <div className="voice-orb-core">
          <span className="voice-orb-blob voice-orb-blob-a" />
          <span className="voice-orb-blob voice-orb-blob-b" />
          <span className="voice-orb-blob voice-orb-blob-c" />
          <span className="voice-orb-blob voice-orb-blob-d" />
        </div>
        <div className="voice-orb-ring" />
      </div>

      <div className={`voice-status-pill voice-status-${status}`}>
        <span className="voice-status-dot" aria-hidden />
        {statusLabel(status)}
      </div>

      <button
        type="button"
        className={
          'voice-mic-btn' +
          (isLive ? ' live' : '') +
          (status === 'error' ? ' has-error' : '') +
          (!isConfigured ? ' disabled' : '')
        }
        onClick={() => void toggle()}
        title={
          !isConfigured
            ? 'Configure ElevenLabs in Settings → Voice first'
            : isLive
              ? 'End conversation'
              : 'Start conversation'
        }
        aria-pressed={isLive}
      >
        {isLive ? <StopIcon size={20} /> : <MicIcon size={22} />}
        <span className="voice-mic-btn-label">
          {!isConfigured
            ? 'Set up voice…'
            : isLive
              ? 'Tap to end'
              : status === 'connecting'
                ? 'Connecting…'
                : 'Tap to talk'}
        </span>
      </button>

      {error && <div className="voice-error">{error}</div>}

      {(lastMessage || isLive) && (
        <div className="voice-transcript" title={lastMessage}>
          {lastMessage ?? 'Listening…'}
        </div>
      )}
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'connecting':
      return 'Connecting';
    case 'listening':
      return 'Listening';
    case 'speaking':
      return 'Speaking';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}
