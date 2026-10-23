import React, { useState } from 'react';
import {
  Download,
  Trash2,
  Eye,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, Button, Pill, SectionHeader } from './ui';
import type { StoredEcgRecord } from '../utils/ecgStorage';
import { downloadWaveformImage } from '../utils/ecgStorage';
import { rhythmLabel } from '../services/ecgAnalysis';

interface Props {
  records: StoredEcgRecord[];
  onLoadRecord: (record: StoredEcgRecord) => void;
  onDeleteRecord: (id: string) => void;
  onClearAll: () => void;
}

const LocalEcgHistory: React.FC<Props> = ({
  records,
  onLoadRecord,
  onDeleteRecord,
  onClearAll,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <SectionHeader
        eyebrow="Local Device Storage"
        title="Saved ECG Waveforms &amp; Analyses"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Pill tone={records.length > 0 ? 'accent' : 'neutral'} size="sm">
              {records.length} {records.length === 1 ? 'record' : 'records'}
            </Pill>
            {records.length > 0 && (
              <Button
                onClick={onClearAll}
                variant="ghost"
                size="sm"
                leadingIcon={<Trash2 size={13} />}
                style={{ color: 'var(--error)' }}
              >
                Clear all
              </Button>
            )}
          </div>
        }
      />

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {records.length === 0 ? (
          <div
            style={{
              padding: 'var(--sp-6)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              color: 'var(--ink-3)',
            }}
          >
            <ImageIcon size={32} style={{ opacity: 0.4 }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
              No ECG recordings saved locally on this device yet.
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-4)', maxWidth: '45ch' }}>
              When you scan an ECG or load a sample trace, click &ldquo;Save to Device&rdquo; to store the waveform image, heartbeat calculation, and analysis locally in your browser.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {records.map((rec) => {
              const isExpanded = expandedId === rec.id;
              const hr = rec.heartRateBpm;
              const layman = rec.analysis.layman_summary;

              return (
                <div
                  key={rec.id}
                  style={{
                    padding: 'var(--sp-4)',
                    borderRadius: 'var(--r-2)',
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--hairline)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--sp-3)',
                  }}
                >
                  {/* Top Bar: Date, Pills, Actions */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Pill tone={rec.rhythm === 'sinus_rhythm' ? 'success' : 'warn'} dot size="sm">
                        {rhythmLabel(rec.rhythm)}
                      </Pill>
                      {hr && (
                        <Pill tone="neutral" size="sm">
                          ❤️ {hr} BPM
                        </Pill>
                      )}
                      <Pill tone="neutral" size="sm">
                        {rec.totalBeats} beats ({rec.durationSec.toFixed(1)}s)
                      </Pill>
                      {rec.regularityPct != null && (
                        <Pill tone={rec.regularityPct >= 80 ? 'success' : 'warn'} size="sm">
                          {rec.regularityPct}% regular
                        </Pill>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Button
                        onClick={() => onLoadRecord(rec)}
                        variant="secondary"
                        size="sm"
                        leadingIcon={<Eye size={13} />}
                        title="Load into interactive waveform viewer"
                      >
                        Load Trace
                      </Button>
                      <Button
                        onClick={() => downloadWaveformImage(rec)}
                        variant="ghost"
                        size="sm"
                        leadingIcon={<Download size={13} />}
                        title="Download ECG Waveform PNG"
                      >
                        Image
                      </Button>
                      <Button
                        onClick={() => onDeleteRecord(rec.id)}
                        variant="ghost"
                        size="sm"
                        leadingIcon={<Trash2 size={13} />}
                        style={{ color: 'var(--error)' }}
                        title="Delete recording from device"
                      />
                    </div>
                  </div>

                  {/* Waveform Image Strip Preview */}
                  {rec.waveformImage && (
                    <div
                      style={{
                        position: 'relative',
                        borderRadius: 'var(--r-1)',
                        overflow: 'hidden',
                        border: '1px solid var(--hairline)',
                        cursor: 'pointer',
                        background: '#0f172a',
                      }}
                      onClick={() => setPreviewImage(rec.waveformImage)}
                      title="Click to view full waveform image"
                    >
                      <img
                        src={rec.waveformImage}
                        alt={`ECG Waveform ${rec.dateLabel}`}
                        style={{
                          width: '100%',
                          height: '90px',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          right: 8,
                          bottom: 6,
                          background: 'rgba(15, 23, 42, 0.75)',
                          padding: '2px 6px',
                          borderRadius: 'var(--r-1)',
                          fontSize: '10px',
                          color: 'var(--ink-3)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <ImageIcon size={10} /> Click to expand
                      </div>
                    </div>
                  )}

                  {/* Plain English Summary Headline */}
                  {layman?.plain_text_summary && (
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>
                      <strong>Summary:</strong> {layman.plain_text_summary}
                    </p>
                  )}

                  {/* Toggle More Details */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: 'var(--text-xs)',
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontWeight: 500,
                      }}
                    >
                      {isExpanded ? 'Hide Analysis Details' : 'View Heartbeat & Rhythm Details'}
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {isExpanded && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 'var(--sp-3)',
                          borderRadius: 'var(--r-1)',
                          background: 'var(--surface)',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                          gap: 'var(--sp-3)',
                          fontSize: 'var(--text-xs)',
                        }}
                      >
                        <div>
                          <span style={{ color: 'var(--ink-3)' }}>Heart Rate Range:</span>
                          <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                            {rec.minHeartRateBpm ?? hr}–{rec.maxHeartRateBpm ?? hr} BPM
                          </div>
                        </div>
                        <div>
                          <span style={{ color: 'var(--ink-3)' }}>R-R Interval:</span>
                          <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                            {rec.analysis.hrv?.mean_rr ? `${rec.analysis.hrv.mean_rr} ms` : '--'}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: 'var(--ink-3)' }}>HRV (SDNN):</span>
                          <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                            {rec.analysis.hrv?.sdnn ? `${rec.analysis.hrv.sdnn} ms` : '--'}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: 'var(--ink-3)' }}>Extra Beats (PVC/PAC):</span>
                          <div style={{ fontWeight: 600 }}>
                            {Math.round(((rec.analysis.pvc_burden ?? 0) + (rec.analysis.pac_burden ?? 0)) * 100)}%
                          </div>
                        </div>
                        {rec.analysis.insights && rec.analysis.insights.length > 0 && (
                          <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
                            <span style={{ color: 'var(--ink-3)', fontWeight: 600 }}>Insights:</span>
                            <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: 'var(--ink-2)' }}>
                              {rec.analysis.insights.map((ins, idx) => (
                                <li key={idx}>{ins.text}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Full Image Preview Modal */}
      {previewImage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setPreviewImage(null)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '85vh',
              background: '#0f172a',
              borderRadius: 'var(--r-3)',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              border: '1px solid var(--hairline)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage}
              alt="Expanded ECG Waveform"
              style={{ width: '100%', maxHeight: '75vh', objectFit: 'contain', display: 'block' }}
            />
            <div
              style={{
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#1e293b',
              }}
            >
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                Single-lead AD8232 ECG Waveform Strip
              </span>
              <Button onClick={() => setPreviewImage(null)} variant="secondary" size="sm">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default LocalEcgHistory;
