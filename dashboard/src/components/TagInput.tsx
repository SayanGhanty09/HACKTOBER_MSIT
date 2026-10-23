// src/components/TagInput.tsx
import React, { useState, useEffect, useRef } from 'react';
import { getOpenRouterKey } from '../utils/aiPreferences';

type TagInputProps = {
  label: string;
  placeholder?: string;
  values: string[];
  setValues: (v: string[]) => void;
  presetSuggestions?: string[];
};

const formatTagLabel = (tag: string) =>
  tag
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const TagInput: React.FC<TagInputProps> = ({ label, placeholder, values, setValues, presetSuggestions }) => {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const timerRef = useRef<number | null>(null);

  const fetchSuggestions = async (query: string) => {
    const apiKey = getOpenRouterKey();
    if (!apiKey) return [];
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: `Give up to 5 short suggestions for ${label.toLowerCase()} that start with "${query}".` }],
          temperature: 0.3,
        }),
      });
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return text
        .split(/[\,\n]/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
    } catch (_) {
      return [];
    }
  };

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!input) {
      setSuggestions([]);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      const sug = await fetchSuggestions(input);
      setSuggestions(sug);
      setShowSuggestions(true);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [input]);

  const addTag = (tag: string) => {
    const cleanTag = tag.trim().toLowerCase();
    if (cleanTag && !values.includes(cleanTag)) {
      setValues([...values, cleanTag]);
    }
    setInput('');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const removeTag = (tag: string) => {
    setValues(values.filter((v) => v !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      addTag(input.trim());
    }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontWeight: 650, marginBottom: 8, fontSize: 'var(--text-base)', color: 'var(--ink-2)' }}>{label}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {values.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-soft-2)',
              color: 'var(--accent)',
              padding: '4px 10px',
              borderRadius: 16,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {formatTagLabel(tag)}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                color: 'var(--accent)',
                padding: '0 2px',
                fontSize: 16,
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => input && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid var(--hairline)',
          background: 'var(--surface)',
          color: 'var(--ink)',
          fontSize: '16px',
          lineHeight: 1.4,
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color 0.2s ease',
        }}
      />
      {presetSuggestions && presetSuggestions.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>eg:</span>
          {presetSuggestions.map((sug) => {
            const isSelected = values.includes(sug);
            return (
              <button
                type="button"
                key={sug}
                onClick={() => isSelected ? removeTag(sug) : addTag(sug)}
                style={{
                  background: isSelected ? 'var(--accent)' : 'var(--surface-sunken)',
                  color: isSelected ? '#fff' : 'var(--ink-2)',
                  border: isSelected ? '1px solid var(--accent)' : '1px solid var(--hairline)',
                  padding: '3px 8px',
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 550,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {formatTagLabel(sug)}
              </button>
            );
          })}
        </div>
      )}
      {showSuggestions && suggestions.length > 0 && (
        <div style={{ position: 'relative', marginTop: 4 }}>
          <ul
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              background: 'var(--paper)',
              border: '1px solid var(--hairline)',
              borderRadius: 8,
              maxHeight: 150,
              overflowY: 'auto',
              zIndex: 10,
              listStyle: 'none',
              margin: 0,
              padding: '4px 0',
              boxShadow: 'var(--shadow-pop)',
            }}
          >
            {suggestions.map((s) => (
              <li
                key={s}
                onMouseDown={() => addTag(s)}
                style={{
                  padding: '8px 14px',
                  cursor: 'pointer',
                  color: 'var(--ink)',
                  fontSize: 13,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
