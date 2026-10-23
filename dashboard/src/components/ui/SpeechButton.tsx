import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Sparkles, Loader2 } from 'lucide-react';
import { speakText, stopSpeech, subscribeSpeechState } from '../../utils/elevenLabsClient';

interface SpeechButtonProps {
  text: string;
  label?: string;
  compact?: boolean;
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
  voiceId?: string;
}

export const SpeechButton: React.FC<SpeechButtonProps> = ({
  text,
  label = 'Read Aloud',
  compact = false,
  size = 'sm',
  style,
  voiceId,
}) => {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return subscribeSpeechState((active) => {
      if (!active) {
        setSpeaking(false);
        setLoading(false);
      }
    });
  }, []);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Unlock speech synthesis in user gesture
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }

    if (speaking) {
      stopSpeech();
      setSpeaking(false);
      return;
    }

    if (!text || !text.trim()) return;

    setLoading(true);
    setSpeaking(true);

    try {
      await speakText(text, {
        voiceId,
        onStart: () => {
          setLoading(false);
          setSpeaking(true);
        },
        onEnd: () => {
          setSpeaking(false);
          setLoading(false);
        },
        onError: () => {
          setSpeaking(false);
          setLoading(false);
        },
      });
    } catch (_) {
      setSpeaking(false);
      setLoading(false);
    }
  };

  const isSmall = size === 'sm';

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={speaking ? 'Stop speaking' : 'Listen with ElevenLabs Voice'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: isSmall ? 28 : 34,
          height: isSmall ? 28 : 34,
          borderRadius: 'var(--r-pill)',
          border: speaking ? '1px solid rgba(66, 133, 244, 0.4)' : '1px solid var(--hairline)',
          background: speaking ? 'rgba(66, 133, 244, 0.12)' : 'var(--surface-sunken)',
          color: speaking ? '#2563eb' : 'var(--ink-3)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          padding: 0,
          ...style,
        }}
      >
        {loading ? (
          <Loader2 size={isSmall ? 13 : 16} className="spin" />
        ) : speaking ? (
          <VolumeX size={isSmall ? 13 : 16} />
        ) : (
          <Volume2 size={isSmall ? 13 : 16} />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={speaking ? 'Stop speaking' : 'Listen with ElevenLabs AI Voice'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: isSmall ? '5px 10px' : '7px 14px',
        borderRadius: 'var(--r-2)',
        border: speaking ? '1px solid rgba(66, 133, 244, 0.4)' : '1px solid var(--hairline)',
        background: speaking ? 'rgba(66, 133, 244, 0.1)' : 'var(--surface)',
        color: speaking ? '#2563eb' : 'var(--ink-2)',
        fontFamily: 'var(--font-sans)',
        fontSize: isSmall ? 'var(--text-xs)' : 'var(--text-sm)',
        fontWeight: 500,
        cursor: 'pointer',
        boxShadow: speaking ? '0 0 10px rgba(66, 133, 244, 0.2)' : 'var(--shadow-1)',
        transition: 'all 0.2s ease',
        ...style,
      }}
    >
      {loading ? (
        <Loader2 size={13} className="spin" style={{ color: '#2563eb' }} />
      ) : speaking ? (
        <VolumeX size={13} style={{ color: '#ef4444' }} />
      ) : (
        <Volume2 size={13} style={{ color: '#4285f4' }} />
      )}
      <span>{speaking ? 'Stop Voice' : label}</span>
      <Sparkles size={11} style={{ color: '#8b5cf6', opacity: 0.8 }} />
    </button>
  );
};

export default SpeechButton;
