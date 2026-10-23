import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, UserPlus, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui';

const Login: React.FC = () => {
  const { login, signup, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        if (!email.trim() || !password.trim()) {
          setError('Please fill in all fields');
          setIsSubmitting(false);
          return;
        }
        const err = await login(email.trim(), password);
        if (err) setError(err);
      } else {
        if (!name.trim() || !email.trim() || !password.trim()) {
          setError('Please fill in all required fields');
          setIsSubmitting(false);
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters');
          setIsSubmitting(false);
          return;
        }
        const err = await signup(name.trim(), email.trim(), specialty.trim() || 'General', password);
        if (err) setError(err);
        else {
          setName('');
          setEmail('');
          setPassword('');
          setSpecialty('');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = isSubmitting || authLoading;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(420px, 520px)',
        background: 'var(--paper)',
      }}
    >
      {/* ===================== Marquee panel ===================== */}
      <aside
        style={{
          position: 'relative',
          background: 'var(--ink)',
          color: 'var(--paper)',
          padding: 'clamp(32px, 5vw, 72px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          overflow: 'hidden',
        }}
      >
        {/* Decorative grid */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(color-mix(in oklab, var(--paper) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--paper) 6%, transparent) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage:
              'radial-gradient(circle at 30% 40%, black 0%, transparent 70%)',
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        />

        <header style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            aria-hidden
            style={{
              width: 30, height: 30,
              background: 'var(--paper)', color: 'var(--ink)',
              borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 20, lineHeight: 1, fontStyle: 'italic',
            }}
          >
            A
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: '-0.02em' }}>
            Anebilin
          </span>
        </header>

        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 520 }}>
          <span
            style={{
              fontSize: 'var(--text-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: 'color-mix(in oklab, var(--paper) 60%, transparent)',
              fontWeight: 500,
            }}
          >
            Clinical biomarker workstation
          </span>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(40px, 5vw, 64px)',
              lineHeight: 1.02,
              letterSpacing: '-0.025em',
              fontWeight: 400,
            }}
          >
            Non-invasive screening,
            <br />
            <em style={{ fontStyle: 'italic', color: 'color-mix(in oklab, var(--paper) 70%, transparent)' }}>
              instrument-grade.
            </em>
          </h1>
          <p
            style={{
              color: 'color-mix(in oklab, var(--paper) 60%, transparent)',
              fontSize: 'var(--text-md)',
              maxWidth: '46ch',
              lineHeight: 1.6,
            }}
          >
            Capture haemoglobin, bilirubin, SpO₂, HR and BP from a single 30-second pulse.
            Sessions sync to your patient ledger automatically.
          </p>
        </div>

        <footer
          style={{
            position: 'relative',
            display: 'flex',
            gap: 32,
            color: 'color-mix(in oklab, var(--paper) 50%, transparent)',
            fontSize: 'var(--text-sm)',
            paddingTop: 24,
            borderTop: '1px solid color-mix(in oklab, var(--paper) 10%, transparent)',
          }}
        >
          <span>v1.2.0</span>
          <span>Screening-only — not for diagnosis</span>
        </footer>
      </aside>

      {/* ===================== Auth form ===================== */}
      <main
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'clamp(24px, 4vw, 56px)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}
        >
          <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                fontWeight: 500,
              }}
            >
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </span>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-3xl)',
                fontWeight: 400,
                letterSpacing: '-0.022em',
                lineHeight: 1.05,
                color: 'var(--ink)',
              }}
            >
              {mode === 'login' ? (
                <>Welcome <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>back</em>.</>
              ) : (
                <>Start <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>practising</em>.</>
              )}
            </h2>
            <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-base)' }}>
              {mode === 'login'
                ? 'Sign in to access your patient ledger and live monitoring.'
                : 'Register your credentials to begin recording sessions.'}
            </p>
          </header>

          {/* Mode switch */}
          <div
            role="tablist"
            style={{
              display: 'inline-flex',
              padding: 3,
              gap: 2,
              background: 'var(--surface-tint)',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--r-pill)',
              alignSelf: 'flex-start',
            }}
          >
            {(['login', 'signup'] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setMode(m); setError(''); }}
                  disabled={isLoading}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--r-pill)',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    fontWeight: active ? 600 : 500,
                    fontSize: 'var(--text-sm)',
                    border: active ? '1px solid var(--hairline)' : '1px solid transparent',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    transition: 'background-color var(--t-2) var(--ease), color var(--t-2) var(--ease)',
                  }}
                >
                  {m === 'login' ? 'Sign in' : 'Sign up'}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            {mode === 'signup' && (
              <>
                <Field label="Full name" required>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dr. Jane Smith"
                    disabled={isLoading}
                  />
                </Field>
                <Field label="Specialty">
                  <input
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    placeholder="Cardiologist, General physician…"
                    disabled={isLoading}
                  />
                </Field>
              </>
            )}

            <Field label="Email" required>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@clinic.com"
                disabled={isLoading}
              />
            </Field>

            <Field label="Password" required>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                  disabled={isLoading}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={isLoading}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    width: 28, height: 28,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 0, color: 'var(--ink-3)',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    borderRadius: 'var(--r-2)',
                  }}
                >
                  {showPassword ? <EyeOff size={16} strokeWidth={1.6} /> : <Eye size={16} strokeWidth={1.6} />}
                </button>
              </div>
            </Field>

            {error && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 'var(--r-2)',
                  background: 'var(--error-soft)',
                  border: '1px solid color-mix(in oklab, var(--error) 22%, transparent)',
                  color: 'var(--error)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                <AlertCircle size={14} strokeWidth={1.8} />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={isLoading}
              leadingIcon={mode === 'login' ? <LogIn size={16} strokeWidth={1.8} /> : <UserPlus size={16} strokeWidth={1.8} />}
            >
              {isLoading
                ? mode === 'login' ? 'Signing in' : 'Creating account'
                : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-4)', textAlign: 'center' }}>
            By continuing you confirm this device is operated under medical supervision.
          </p>
        </motion.div>
      </main>
    </div>
  );
};

const Field: React.FC<React.PropsWithChildren<{ label: string; required?: boolean }>> = ({ label, required, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <span
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        fontWeight: 600,
      }}
    >
      {label}
      {required && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
    </span>
    {children}
  </label>
);

export default Login;
