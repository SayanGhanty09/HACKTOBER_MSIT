import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  MapPin, TrendingUp, AlertTriangle, Loader2, Settings,
  Check, AlertCircle, Users, Activity,
} from 'lucide-react';
import { usePatientStore } from '../contexts/PatientStore';
import {
  aggregateDataByRegion,
  formatRegionalSummaryForAI,
  type RegionalStats,
} from '../utils/regionalDataAggregator';
import {
  generateRegionalAnalysis,
  generateRuleBasedRegionalAnalysis,
  isValidOpenRouterKey,
  type RegionalReport,
} from '../utils/openRouterClient';
import {
  getOpenRouterKey,
  getOpenRouterModel,
} from '../utils/aiPreferences';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type TileProvider = {
  id: string;
  name: string;
  url: string;
  attribution: string;
  maxZoom?: number;
  subdomains?: string;
};

function buildTileLayerOptions(provider: TileProvider): L.TileLayerOptions {
  return {
    attribution: provider.attribution,
    maxZoom: provider.maxZoom ?? 19,
    ...(provider.subdomains ? { subdomains: provider.subdomains } : {}),
  };
}

const FREE_TILE_PROVIDERS: TileProvider[] = [
  {
    id: 'osm-hot',
    name: 'OSM Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors, Tiles style by HOT',
    maxZoom: 19,
  },
  {
    id: 'esri-streets',
    name: 'Esri World Street',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
    maxZoom: 19,
  },
  {
    id: 'carto-voyager',
    name: 'Carto Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  {
    id: 'osm-standard',
    name: 'OpenStreetMap Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
];

const RISK_COLOR: Record<string, string> = {
  Low:    'var(--success)',
  Medium: 'var(--warn)',
  High:   'var(--error)',
};
const RISK_BG: Record<string, string> = {
  Low:    'var(--success-soft)',
  Medium: 'var(--warn-soft)',
  High:   'var(--error-soft)',
};
const RISK_HEX: Record<string, string> = {
  Low:    '#22c55e',
  Medium: '#f59e0b',
  High:   '#ef4444',
};

const ShimmerLine: React.FC<{ width?: string; delay?: number }> = ({ width = '100%', delay = 0 }) => (
  <div style={{
    height: 10, width, borderRadius: 'var(--r-pill)',
    background: 'var(--surface-sunken)', overflow: 'hidden', position: 'relative',
  }}>
    <motion.div
      initial={{ x: '-110%' }}
      animate={{ x: '110%' }}
      transition={{ duration: 1.3, repeat: Infinity, ease: 'linear', delay }}
      style={{
        position: 'absolute', inset: 0, width: '50%', borderRadius: 'var(--r-pill)',
        background: 'linear-gradient(90deg, transparent 0%, rgba(13,110,110,0.28) 50%, transparent 100%)',
      }}
    />
  </div>
);

const RegionalAnalytics: React.FC = () => {
  const { patients, recordings } = usePatientStore();
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [regionalStats, setRegionalStats] = useState<RegionalStats[]>([]);
  const [regionalReports, setRegionalReports] = useState<Record<string, RegionalReport>>({});
  const [analysisMessages, setAnalysisMessages] = useState<Record<string, string>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [selectedMapProvider, setSelectedMapProvider] = useState<string>(() =>
    localStorage.getItem('regional_map_provider') || 'osm-hot'
  );
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const tileLayerRef = React.useRef<L.TileLayer | null>(null);
  const markerLayersRef = React.useRef<Record<string, L.CircleMarker>>({});

  useEffect(() => {
    setRegionalStats(aggregateDataByRegion(patients, recordings));
  }, [patients, recordings]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;
    try {
      const map = L.map(mapContainerRef.current, { attributionControl: true }).setView([20.5937, 78.9629], 4);
      mapRef.current = map;
      setIsMapReady(true);
    } catch (err) {
      console.error('Failed to initialize map:', err);
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    localStorage.setItem('regional_map_provider', selectedMapProvider);

    if (tileLayerRef.current) { mapRef.current.removeLayer(tileLayerRef.current); tileLayerRef.current = null; }

    const provider = FREE_TILE_PROVIDERS.find(p => p.id === selectedMapProvider) || FREE_TILE_PROVIDERS[0];
    const layer = L.tileLayer(provider.url, { ...buildTileLayerOptions(provider) });

    layer.on('tileerror', () => {
      if (!mapRef.current || provider.id === 'osm-standard') return;
      if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
      const fallback = FREE_TILE_PROVIDERS.find(p => p.id === 'osm-standard');
      if (!fallback) return;
      tileLayerRef.current = L.tileLayer(fallback.url, { ...buildTileLayerOptions(fallback) }).addTo(mapRef.current);
    });

    layer.addTo(mapRef.current);
    tileLayerRef.current = layer;
  }, [selectedMapProvider, isMapReady]);

  useEffect(() => {
    if (!mapRef.current) return;
    Object.values(markerLayersRef.current).forEach(m => mapRef.current?.removeLayer(m));
    markerLayersRef.current = {};

    regionalStats.forEach(region => {
      const isSelected = region.region === selectedRegion;
      const radius = 8 + (region.recordingCount / 5) * 2;
      const color = RISK_HEX[region.riskLevel];

      const marker = L.circleMarker([region.latitude, region.longitude], {
        radius: isSelected ? radius + 5 : radius,
        fillColor: color,
        color: isSelected ? '#0d6e6e' : color,
        weight: isSelected ? 4 : 2,
        opacity: 0.85,
        fillOpacity: isSelected ? 0.85 : 0.55,
      })
        .bindPopup(`<div style="font-size:12px;line-height:1.5"><strong>${region.region}</strong><br>Patients: ${region.patientCount}<br>Recordings: ${region.recordingCount}<br>Risk: ${region.riskLevel}</div>`)
        .on('click', () => setSelectedRegion(region.region))
        .addTo(mapRef.current!);

      markerLayersRef.current[region.region] = marker;
    });
  }, [regionalStats, selectedRegion]);

  const handleAnalyzeRegion = async () => {
    if (!selectedRegion) return;
    const region = regionalStats.find(r => r.region === selectedRegion);
    if (!region) return;

    const openRouterKey = getOpenRouterKey();
    setShowReportPanel(true);
    setAnalysisMessages(prev => ({ ...prev, [region.region]: '' }));
    setIsAnalyzing(true);

    if (!openRouterKey || !isValidOpenRouterKey(openRouterKey)) {
      const fallback = generateRuleBasedRegionalAnalysis(
        region.region,
        region,
        'OpenRouter API key not configured in Settings. Generated report using local epidemiological engine.'
      );
      setRegionalReports(prev => ({ ...prev, [region.region]: { ...fallback, riskLevel: region.riskLevel } }));
      setIsAnalyzing(false);
      return;
    }

    try {
      const summary = formatRegionalSummaryForAI([region]);
      const report = await generateRegionalAnalysis(
        region.region, summary, openRouterKey, getOpenRouterModel('regionalAnalytics')
      );
      setRegionalReports(prev => ({ ...prev, [region.region]: { ...report, riskLevel: region.riskLevel } }));
      setAnalysisMessages(prev => ({ ...prev, [region.region]: '' }));
    } catch (error) {
      console.warn('Regional AI call failed, falling back to local rule-engine:', error);
      const message = error instanceof Error ? error.message : 'Unknown error from AI request.';
      const fallback = generateRuleBasedRegionalAnalysis(
        region.region,
        region,
        `AI service unavailable (${message}). Report generated using local epidemiological engine.`
      );
      setRegionalReports(prev => ({ ...prev, [region.region]: { ...fallback, riskLevel: region.riskLevel } }));
      setAnalysisMessages(prev => ({ ...prev, [region.region]: `Notice: ${message} (Displaying local epidemiological screening)` }));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const openRouterConfigured = isValidOpenRouterKey(getOpenRouterKey());
  const selectedRegionData = regionalStats.find(r => r.region === selectedRegion);
  const selectedReport = selectedRegion ? regionalReports[selectedRegion] : null;
  const selectedAnalysisMessage = selectedRegion ? (analysisMessages[selectedRegion] || '') : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
            Population Health
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: 400, color: 'var(--ink)', lineHeight: 1.15 }}>
            Regional Analytics
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '8px 14px', borderRadius: 'var(--r-2)',
            background: openRouterConfigured ? 'var(--success-soft)' : 'var(--error-soft)',
            border: `1px solid ${openRouterConfigured ? 'rgba(31,122,77,0.25)' : 'rgba(179,38,30,0.25)'}`,
            color: openRouterConfigured ? 'var(--success)' : 'var(--error)',
            fontSize: 'var(--text-xs)', fontWeight: 500,
          }}>
            <Settings size={13} />
            {openRouterConfigured ? 'AI configured' : 'Set AI key in Settings'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="map-provider"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Map
            </label>
            <select
              id="map-provider"
              value={selectedMapProvider}
              onChange={e => setSelectedMapProvider(e.target.value)}
              style={{
                padding: '7px 10px', borderRadius: 'var(--r-2)',
                border: '1px solid var(--hairline)',
                background: 'var(--surface)', color: 'var(--ink)',
                fontSize: 'var(--text-xs)', fontWeight: 500, outline: 'none', cursor: 'pointer',
              }}
            >
              {FREE_TILE_PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Map + Region Panel */}
      <div style={{ display: 'flex', gap: 'var(--sp-5)', minHeight: 560 }}>

        {/* Map — isolation: isolate contains Leaflet's internal z-indices (200–700) so they never exceed the sticky topbar (z-index: 90) */}
        <div style={{
          flex: 1,
          background: 'var(--surface)', border: '1px solid var(--hairline)',
          borderRadius: 'var(--r-3)', boxShadow: 'var(--shadow-2)',
          overflow: 'hidden', minHeight: 520,
          position: 'relative',
          isolation: 'isolate',
        }}>
          <div
            ref={mapContainerRef}
            style={{ width: '100%', height: '100%', minHeight: 520 }}
          />
          {!isMapReady && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface-sunken)', color: 'var(--ink-3)',
              fontSize: 'var(--text-sm)', gap: 8,
            }}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              Loading map…
            </div>
          )}
        </div>

        {/* Region sidebar */}
        <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', flexShrink: 0 }}>

          {/* Region list */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--hairline)',
            borderRadius: 'var(--r-3)', boxShadow: 'var(--shadow-2)', overflow: 'hidden', flex: 1,
          }}>
            <div style={{
              padding: '14px 16px', borderBottom: '1px solid var(--hairline)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>Regions</span>
              <span style={{
                fontSize: 'var(--text-xs)', color: 'var(--ink-3)',
                background: 'var(--surface-sunken)', padding: '2px 8px', borderRadius: 'var(--r-pill)',
              }}>
                {regionalStats.length}
              </span>
            </div>

            {regionalStats.length === 0 ? (
              <div style={{
                padding: '40px 20px', textAlign: 'center', color: 'var(--ink-3)',
                fontSize: 'var(--text-sm)',
              }}>
                <MapPin size={28} strokeWidth={1} style={{ marginBottom: 10, opacity: 0.35 }} />
                <p>No regional data available. Add patients with location data to see regions.</p>
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: 400 }}>
                {regionalStats.map(region => {
                  const isSelected = region.region === selectedRegion;
                  return (
                    <button
                      key={region.region}
                      onClick={() => setSelectedRegion(region.region)}
                      style={{
                        width: '100%', textAlign: 'left',
                        padding: '12px 16px',
                        border: 'none', borderBottom: '1px solid var(--hairline)',
                        background: isSelected ? 'var(--accent-soft-2)' : 'transparent',
                        color: 'var(--ink)',
                        cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                        borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                        transition: 'all var(--t-1) var(--ease)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: isSelected ? 600 : 500, fontSize: 'var(--text-sm)', color: 'var(--ink)', marginBottom: 2 }}>
                          {region.region}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                          {region.patientCount} patient{region.patientCount !== 1 ? 's' : ''} · {region.recordingCount} recording{region.recordingCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 'var(--text-xs)', fontWeight: 600, padding: '3px 8px',
                        borderRadius: 'var(--r-pill)',
                        background: RISK_BG[region.riskLevel],
                        color: RISK_COLOR[region.riskLevel],
                        flexShrink: 0,
                      }}>
                        {region.riskLevel}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Generate report button */}
          {selectedRegionData && (
            <button
              onClick={handleAnalyzeRegion}
              disabled={isAnalyzing}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 16px', borderRadius: 'var(--r-2)',
                border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)',
                fontWeight: 600, fontSize: 'var(--text-sm)',
                cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                opacity: isAnalyzing ? 0.65 : 1,
                boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
              }}
            >
              {isAnalyzing
                ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…</>
                : <><TrendingUp size={16} /> Generate AI Report</>}
            </button>
          )}
        </div>
      </div>

      {/* Help callout — no region selected */}
      {!selectedRegion && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderRadius: 'var(--r-2)',
          background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-2)',
          color: 'var(--ink-2)', fontSize: 'var(--text-sm)',
        }}>
          <MapPin size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
          <span>Click on a circle marker on the map or a region in the sidebar to view health data and generate an AI report.</span>
        </div>
      )}

      {/* AI Report Panel */}
      {selectedRegionData && showReportPanel && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          style={{
            background: 'var(--surface)', border: '1px solid var(--hairline)',
            borderRadius: 'var(--r-4)', boxShadow: 'var(--shadow-2)',
            overflow: 'hidden',
          }}
        >
          {/* Report header */}
          <div style={{
            padding: '18px var(--sp-6)', borderBottom: '1px solid var(--hairline)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>
                AI Analysis
              </div>
              <h2 style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-display)', fontWeight: 400, color: 'var(--ink)' }}>
                {selectedRegionData.region}
              </h2>
            </div>
            {isAnalyzing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--accent)', fontSize: 'var(--text-sm)' }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                Generating report…
              </div>
            )}
            {selectedReport && !isAnalyzing && (
              <span style={{
                padding: '5px 14px', borderRadius: 'var(--r-pill)',
                background: RISK_BG[selectedReport.priorityLevel || selectedRegionData.riskLevel],
                color: RISK_COLOR[selectedReport.priorityLevel || selectedRegionData.riskLevel],
                fontSize: 'var(--text-xs)', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {selectedReport.priorityLevel === 'High' ? <AlertTriangle size={12} /> :
                 selectedReport.priorityLevel === 'Medium' ? <AlertCircle size={12} /> :
                 <Check size={12} />}
                {selectedReport.priorityLevel} Priority
              </span>
            )}
          </div>

          <div style={{ padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

            {/* Loading skeleton */}
            {isAnalyzing && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <ShimmerLine width="72%" />
                <ShimmerLine width="88%" delay={0.1} />
                <ShimmerLine width="60%" delay={0.2} />
                <ShimmerLine width="80%" delay={0.05} />
                <ShimmerLine width="65%" delay={0.15} />
              </div>
            )}

            {/* Error message */}
            {Boolean(selectedAnalysisMessage && selectedAnalysisMessage.startsWith('Request failed:')) && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
                borderRadius: 'var(--r-2)', background: 'var(--error-soft)',
                border: '1px solid rgba(179,38,30,0.22)', color: 'var(--error)',
                fontSize: 'var(--text-sm)',
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{selectedAnalysisMessage}</span>
              </div>
            )}

            {/* Report content */}
            {selectedReport && !isAnalyzing && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
                {/* Summary */}
                <div style={{
                  padding: '16px 20px', borderRadius: 'var(--r-3)',
                  background: 'var(--surface-tint)', border: '1px solid var(--hairline)',
                  fontSize: 'var(--text-base)', color: 'var(--ink-2)', lineHeight: 1.65,
                }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Summary
                  </div>
                  {selectedReport.summary}
                </div>

                {/* Key Findings + Recommendations grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
                  <div style={{
                    padding: '16px 20px', borderRadius: 'var(--r-3)',
                    background: 'var(--surface)', border: '1px solid var(--hairline)',
                  }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                      Key Findings
                    </div>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedReport.keyFindings.map((finding, idx) => (
                        <li key={idx} style={{ display: 'flex', gap: 10, fontSize: 'var(--text-sm)', color: 'var(--ink-2)', lineHeight: 1.55 }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>·</span>
                          {finding}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div style={{
                    padding: '16px 20px', borderRadius: 'var(--r-3)',
                    background: 'var(--surface)', border: '1px solid var(--hairline)',
                  }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                      Recommendations
                    </div>
                    <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedReport.recommendations.map((rec, idx) => (
                        <li key={idx} style={{ display: 'flex', gap: 10, fontSize: 'var(--text-sm)', color: 'var(--ink-2)', lineHeight: 1.55 }}>
                          <span style={{
                            flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                            background: 'var(--accent-soft)', color: 'var(--accent)',
                            fontSize: 'var(--text-xs)', fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                          }}>
                            {idx + 1}
                          </span>
                          {rec}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* Stats strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-4)' }}>
                  {[
                    { icon: Users, label: 'Total Patients', value: String(selectedRegionData.patientCount) },
                    { icon: Activity, label: 'Recordings', value: String(selectedRegionData.recordingCount) },
                    { icon: Users, label: 'Avg Age', value: selectedRegionData.ageStats.mean.toFixed(1) },
                    { icon: AlertCircle, label: 'Risk Level', value: selectedRegionData.riskLevel, color: RISK_COLOR[selectedRegionData.riskLevel] },
                  ].map(({ icon: Icon, label, value, color }) => (
                    <div key={label} style={{
                      padding: '14px 16px', borderRadius: 'var(--r-3)',
                      background: 'var(--surface-tint)', border: '1px solid var(--hairline)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <Icon size={13} color="var(--ink-3)" strokeWidth={1.5} />
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', fontWeight: 500 }}>{label}</span>
                      </div>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: color || 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Idle state — report not yet requested */}
            {!selectedReport && !isAnalyzing && !(selectedAnalysisMessage && selectedAnalysisMessage.startsWith('Request failed:')) && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                padding: '40px 20px', color: 'var(--ink-3)', textAlign: 'center',
              }}>
                <TrendingUp size={32} strokeWidth={1} style={{ opacity: 0.35 }} />
                <p style={{ fontSize: 'var(--text-sm)' }}>
                  Click <strong>Generate AI Report</strong> to run a population health analysis for {selectedRegionData.region}.
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

export default RegionalAnalytics;
