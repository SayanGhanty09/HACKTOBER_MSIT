import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Activity,
  Users,
  LayoutDashboard,
  History,
  Cpu,
  Settings as SettingsIcon,
  LogOut,
  Bluetooth,
  BluetoothOff,
  User,
  Loader2,
  Map as MapIcon,
  MapPin,
  HeartPulse,
  Eye,
  EyeOff,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BLEProvider, useBLE, BLEStatus } from '../../contexts/BLEContext';
import { PatientStoreProvider, usePatientStore } from '../../contexts/PatientStore';
import { useAuth } from '../../contexts/AuthContext';
import { usePrivacyMode, setPrivacyMode } from '../../utils/preferences';
import { useTranslation } from '../../utils/useTranslation';

// ----- Accent picker (preserved API + storage key) -----
const ACCENT_STORAGE_KEY = 'spectru_accent_theme';

type AccentTheme = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  glow: string;
};

// Tuned for the clinical-editorial direction — calm, confident hues.
const ACCENT_THEMES: AccentTheme[] = [
  { id: 'aqua',    label: 'Teal',      primary: '#0d6e6e', secondary: '#1b3a5b', glow: 'rgba(13, 110, 110, 0.28)' },
  { id: 'emerald', label: 'Sage',      primary: '#3f7a4d', secondary: '#234d31', glow: 'rgba(63, 122, 77, 0.28)' },
  { id: 'sunset',  label: 'Terracotta',primary: '#b8543f', secondary: '#7a2f1e', glow: 'rgba(184, 84, 63, 0.28)' },
  { id: 'berry',   label: 'Plum',      primary: '#7c4a82', secondary: '#4b2a55', glow: 'rgba(124, 74, 130, 0.28)' },
  { id: 'slate',   label: 'Graphite',  primary: '#3f4756', secondary: '#1f2530', glow: 'rgba(63, 71, 86, 0.28)' },
];

// =========================================================================
// Sidebar item
// =========================================================================
const SidebarItem: React.FC<{
  to: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
}> = ({ to, icon: Icon, label, active }) => {
  return (
    <NavLink to={to} style={{ textDecoration: 'none' }}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 12px 9px 16px',
          margin: '1px 0',
          borderRadius: 'var(--r-2)',
          color: active ? 'var(--ink)' : 'var(--ink-2)',
          background: active ? 'var(--accent-soft)' : 'transparent',
          fontWeight: active ? 600 : 500,
          fontSize: 'var(--text-base)',
          letterSpacing: '-0.005em',
          transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-tint)'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Left accent rail (active state) */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0, top: 6, bottom: 6,
            width: 2,
            borderRadius: 2,
            background: active ? 'var(--accent)' : 'transparent',
            transition: 'background-color var(--t-2) var(--ease)',
          }}
        />
        <Icon size={16} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--accent)' : 'var(--ink-3)'} />
        <span>{label}</span>
      </div>
    </NavLink>
  );
};

// =========================================================================
// Accent swatch picker
// =========================================================================
const AccentSwatches: React.FC<{
  themes: AccentTheme[];
  activeId: string;
  onPick: (id: string) => void;
}> = ({ themes, activeId, onPick }) => (
  <div
    role="radiogroup"
    aria-label="Accent colour"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      background: 'var(--surface)',
      border: '1px solid var(--hairline)',
      borderRadius: 'var(--r-pill)',
    }}
  >
    {themes.map((t) => {
      const active = t.id === activeId;
      return (
        <button
          key={t.id}
          role="radio"
          aria-checked={active}
          aria-label={t.label}
          title={t.label}
          onClick={() => onPick(t.id)}
          style={{
            width: 16, height: 16,
            padding: 0,
            borderRadius: '50%',
            background: t.primary,
            border: active ? `2px solid var(--ink)` : '2px solid transparent',
            boxShadow: active ? `0 0 0 2px var(--paper)` : 'none',
            cursor: 'pointer',
            transition: 'transform var(--t-1) var(--ease)',
          }}
        />
      );
    })}
  </div>
);

// =========================================================================
// BLE chip
// =========================================================================
const BleChip: React.FC<{
  connected: boolean;
  connecting: boolean;
  onClick: () => void;
}> = ({ connected, connecting, onClick }) => {
  const { t } = useTranslation();
  const label = connecting ? t('connecting') : connected ? t('connected') : t('connectDevice');
  const Icon = connected ? Bluetooth : BluetoothOff;
  const tone: 'success' | 'neutral' | 'accent' = connected ? 'success' : connecting ? 'accent' : 'neutral';

  const colors = {
    success: { bg: 'var(--success-soft)', fg: 'var(--success)', ring: 'color-mix(in oklab, var(--success) 22%, transparent)' },
    accent:  { bg: 'var(--accent-soft)',  fg: 'var(--accent)',  ring: 'var(--accent-soft-2)' },
    neutral: { bg: 'var(--surface)',      fg: 'var(--ink-2)',   ring: 'var(--hairline-strong)' },
  }[tone];

  return (
    <button
      onClick={onClick}
      disabled={connecting}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px 6px 10px',
        borderRadius: 'var(--r-pill)',
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.ring}`,
        fontWeight: 500,
        fontSize: 'var(--text-sm)',
        cursor: connecting ? 'wait' : 'pointer',
        letterSpacing: '-0.005em',
        transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease), border-color var(--t-2) var(--ease)',
      }}
    >
      {connecting
        ? <Loader2 size={14} className="animate-spin" />
        : <Icon size={14} strokeWidth={1.8} />}
      <span>{label}</span>
    </button>
  );
};

// =========================================================================
// Live clock (actually ticks)
// =========================================================================
const LiveClock: React.FC = () => {
  const [now, setNow] = useState(() => new Date());
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    // Sync to the next minute boundary, then tick every 60s.
    const ms = 60000 - (Date.now() % 60000);
    const t1 = window.setTimeout(() => {
      tick();
      intervalRef.current = window.setInterval(tick, 60000);
    }, ms);
    return () => {
      window.clearTimeout(t1);
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, []);
  const hours = now.getHours();
  const mins = now.getMinutes().toString().padStart(2, '0');
  const displayHours = (hours % 12 || 12).toString().padStart(2, '0');
  const time = `${displayHours}:${mins} am`;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>
      <span
        className="num"
        style={{
          color: 'var(--ink)',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
        }}
      >
        {time}
      </span>
    </div>
  );
};

// =========================================================================
// Shell
// =========================================================================
const ShellContent: React.FC = () => {
  const { status, connect, disconnect } = useBLE();
  const { doctor, logout } = useAuth();
  const { t, lang, setLang } = useTranslation();
  const location = useLocation();

  const { activePatientName } = usePatientStore();
  const privacyMode = usePrivacyMode();

  const [accentThemeId, setAccentThemeId] = useState<string>(() => {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    return stored && ACCENT_THEMES.some((t) => t.id === stored) ? stored : ACCENT_THEMES[0].id;
  });

  const [isOnline, setIsOnline] = useState(true);

  const isConnected =
    status === BLEStatus.CONNECTED ||
    status === BLEStatus.IDLE ||
    status === BLEStatus.SCANNING ||
    status === BLEStatus.SCANNING_BP;
  const isConnecting = status === BLEStatus.CONNECTING;

  // Drive --accent CSS variables from the picker, persist to storage.
  useEffect(() => {
    const t = ACCENT_THEMES.find((x) => x.id === accentThemeId) || ACCENT_THEMES[0];
    const root = document.documentElement.style;
    root.setProperty('--accent', t.primary);
    root.setProperty('--accent-glow', t.glow);
    // mix soft tints so chips/pills look right against the accent
    root.setProperty('--accent-soft',   `color-mix(in oklab, ${t.primary} 10%, white)`);
    root.setProperty('--accent-soft-2', `color-mix(in oklab, ${t.primary} 18%, white)`);
    // legacy aliases (read by older components)
    root.setProperty('--primary-color', t.primary);
    root.setProperty('--secondary-color', t.secondary);
    root.setProperty('--primary-glow',  t.glow);
    localStorage.setItem(ACCENT_STORAGE_KEY, t.id);
  }, [accentThemeId]);

  const menu = useMemo(
    () => [
      { icon: LayoutDashboard, label: t('dashboard'),          path: '/' },
      { icon: Activity,        label: t('liveRecording'),     path: '/live' },
      { icon: Users,           label: t('patientManagement'), path: '/patients' },
      { icon: MapIcon,         label: t('regionalAnalytics'), path: '/regions' },
      { icon: History,         label: t('statistics'),        path: '/stats' },
      { icon: Cpu,             label: t('deviceConsole'),     path: '/console' },
      { icon: HeartPulse,      label: t('ecgMonitor', 'ECG'), path: '/ecg' },
      { icon: User,            label: t('patientIntake'),     path: '/register' },
      { icon: MapPin,          label: t('teleconsultation'),  path: '/teleconsultation' },
      { icon: SettingsIcon,    label: t('settings'),          path: '/settings' },
    ],
    [t]
  );

  return (
    <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          width: '100vw',
          background: 'var(--paper)',
          position: 'relative',
        }}
      >
        {/* ---------------- Sidebar ---------------- */}
        <nav
          style={{
            width: 'var(--sidebar-width)',
            height: '100vh',
            position: 'fixed',
            left: 0, top: 0,
            padding: '20px 12px 16px',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--paper)',
            borderRight: '1px solid var(--hairline)',
            zIndex: 100,
          }}
        >
          {/* Wordmark */}
          <div style={{ padding: '4px 12px 24px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              aria-hidden
              style={{
                width: 26, height: 26,
                background: 'var(--ink)',
                color: 'var(--paper)',
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                lineHeight: 1,
                fontStyle: 'italic',
              }}
            >
              A
            </span>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
              }}
            >
              Anebilin
            </span>
          </div>

          {/* Section label */}
          <div
            style={{
              padding: '0 12px 8px',
              fontSize: 10,
              color: 'var(--ink-4)',
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              fontWeight: 600,
            }}
          >
            Workspace
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {menu.map((it) => (
              <SidebarItem
                key={it.path}
                to={it.path}
                icon={it.icon}
                label={it.label}
                active={location.pathname === it.path}
              />
            ))}
          </div>

          {/* User footer */}
          <div
            style={{
              marginTop: 'auto',
              padding: '12px 12px',
              borderTop: '1px solid var(--hairline)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 30, height: 30,
                borderRadius: '50%',
                background: 'var(--surface-tint)',
                border: '1px solid var(--hairline)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-3)',
                flexShrink: 0,
              }}
            >
              <User size={15} strokeWidth={1.6} />
            </div>
            <div style={{ flex: 1, minWidth: 0, filter: privacyMode ? 'blur(6px)' : 'none', transition: 'filter var(--t-2) var(--ease)' }}>
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  color: 'var(--ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {doctor?.name ?? 'Doctor'}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--ink-4)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {doctor?.specialty ?? 'Physician'}
              </div>
            </div>
            <button
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              style={{
                padding: 6,
                color: 'var(--ink-3)',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: 'var(--r-2)',
                cursor: 'pointer',
                transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--surface-tint)';
                e.currentTarget.style.color = 'var(--ink)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--ink-3)';
              }}
            >
              <LogOut size={15} strokeWidth={1.6} />
            </button>
          </div>
        </nav>

        {/* ---------------- Main column ---------------- */}
        <main
          style={{
            marginLeft: 'var(--sidebar-width)',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          {/* Top bar */}
          <header
            style={{
              height: 'var(--topbar-height)',
              padding: '0 var(--sp-7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--sp-5)',
              position: 'sticky',
              top: 0,
              zIndex: 90,
              background: 'color-mix(in oklab, var(--paper) 88%, transparent)',
              backdropFilter: 'saturate(140%) blur(10px)',
              WebkitBackdropFilter: 'saturate(140%) blur(10px)',
              borderBottom: '1px solid var(--hairline)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', minWidth: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--ink-4)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    fontWeight: 600,
                  }}
                >
                  {t('activePatient')}
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    color: activePatientName ? 'var(--ink)' : 'var(--error)',
                    fontSize: 'var(--text-md)',
                    letterSpacing: '-0.01em',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    filter: privacyMode ? 'blur(6px)' : 'none',
                    transition: 'filter var(--t-2) var(--ease)',
                  }}
                >
                  {activePatientName || t('noneSelected')}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
              <button
                onClick={() => setPrivacyMode(!privacyMode)}
                aria-label={privacyMode ? t('privacyOn') : t('privacyOn')}
                title={privacyMode ? t('privacyOn') : t('privacyOn')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 'var(--r-pill)',
                  background: privacyMode ? 'var(--warn-soft)' : 'transparent',
                  color: privacyMode ? 'var(--warn)' : 'var(--ink-3)',
                  border: `1px solid ${privacyMode ? 'color-mix(in oklab, var(--warn) 22%, transparent)' : 'var(--hairline)'}`,
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease), border-color var(--t-2) var(--ease)',
                }}
              >
                {privacyMode ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                {privacyMode && <span>{t('privacyOn')}</span>}
              </button>
              <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as any)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--hairline)',
                  borderRadius: 'var(--r-pill)',
                  padding: '4px 10px',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  fontWeight: 500,
                  outline: 'none',
                }}
              >
                <option value="en">🌐 English</option>
                <option value="hi">🇮🇳 हिंदी</option>
                <option value="ta">🇮🇳 தமிழ்</option>
              </select>
              <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />
              <AccentSwatches themes={ACCENT_THEMES} activeId={accentThemeId} onPick={setAccentThemeId} />
              <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />
              {/* Dummy Online/Offline Status Button */}
              <button
                onClick={() => setIsOnline(!isOnline)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 'var(--r-pill)',
                  background: isOnline ? 'var(--success-soft)' : '#fff1f2',
                  color: isOnline ? 'var(--success)' : '#dc2626',
                  border: `1px solid ${isOnline ? 'color-mix(in oklab, var(--success) 22%, transparent)' : '#fca5a5'}`,
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  transition: 'all var(--t-2) var(--ease)',
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: isOnline ? 'var(--success)' : '#dc2626',
                  display: 'inline-block'
                }} />
                <span>{isOnline ? 'Online' : 'Offline'}</span>
              </button>
              <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />
              <BleChip
                connected={isConnected}
                connecting={isConnecting}
                onClick={async () => {
                  if (isConnected) {
                    disconnect();
                  } else {
                    try {
                      await connect();
                    } catch (err) {
                      console.error("BLE connection error:", err);
                    }
                  }
                }}
              />
              <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />
              <LiveClock />
            </div>
          </header>

          {/* Page area */}
          <section
            style={{
              flex: 1,
              padding: 'var(--sp-8) clamp(24px, 4vw, 56px)',
              maxWidth: 'var(--content-max)',
              width: '100%',
              alignSelf: 'center',
              position: 'relative',
            }}
          >
            <div
              style={{
                filter: privacyMode ? 'blur(10px)' : 'none',
                userSelect: privacyMode ? 'none' : 'auto',
                transition: 'filter var(--t-2) var(--ease)',
              }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </div>

            {privacyMode && (
              <button
                onClick={() => setPrivacyMode(false)}
                style={{
                  position: 'fixed',
                  bottom: 'var(--sp-6)',
                  right: 'var(--sp-6)',
                  zIndex: 200,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  border: 'none',
                  boxShadow: 'var(--shadow-3)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                }}
              >
                <Eye size={14} strokeWidth={2} />
                Reveal data
              </button>
            )}
          </section>
        </main>
      </div>
  );
};

const Shell: React.FC = () => (
  <BLEProvider>
    <PatientStoreProvider>
      <ShellContent />
    </PatientStoreProvider>
  </BLEProvider>
);

export default Shell;
