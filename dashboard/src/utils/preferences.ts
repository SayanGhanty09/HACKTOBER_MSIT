import { useState, useEffect } from 'react';

export const BP_CAPTURE_STORAGE = 'spectru_bp_capture_enabled';
export const HIDE_BP_RESP_STORAGE = 'spectru_hide_bp_resp';

export function getHideBPAndRespiration(): boolean {
  const raw = localStorage.getItem(HIDE_BP_RESP_STORAGE);
  if (raw !== null) return raw === 'true';
  const bpCap = localStorage.getItem(BP_CAPTURE_STORAGE);
  if (bpCap !== null) return bpCap === 'false';
  return false;
}

export function setHideBPAndRespiration(hide: boolean): void {
  localStorage.setItem(HIDE_BP_RESP_STORAGE, String(hide));
  localStorage.setItem(BP_CAPTURE_STORAGE, String(!hide));
  window.dispatchEvent(new Event('preferences_updated'));
}

export function getBPCaptureEnabled(): boolean {
  return !getHideBPAndRespiration();
}

export function setBPCaptureEnabled(enabled: boolean): void {
  setHideBPAndRespiration(!enabled);
}

export function useHideBPAndRespiration(): boolean {
  const [hide, setHide] = useState(() => getHideBPAndRespiration());

  useEffect(() => {
    const handleUpdate = () => setHide(getHideBPAndRespiration());
    window.addEventListener('preferences_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('preferences_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  return hide;
}

// ----------------------------------------------------------------------
// Privacy mode — a visual "shoulder-surfing" screen. When on, patient data
// and readings across the app are blurred until switched off again. This is
// a display-only mask (CSS blur), not an access-control/security boundary —
// it does not encrypt, hide from devtools, or block anyone with the toggle.
// ----------------------------------------------------------------------
export const PRIVACY_MODE_STORAGE = 'spectru_privacy_mode';

export function getPrivacyMode(): boolean {
  return localStorage.getItem(PRIVACY_MODE_STORAGE) === 'true';
}

export function setPrivacyMode(enabled: boolean): void {
  localStorage.setItem(PRIVACY_MODE_STORAGE, String(enabled));
  window.dispatchEvent(new Event('preferences_updated'));
}

export function usePrivacyMode(): boolean {
  const [enabled, setEnabled] = useState(() => getPrivacyMode());

  useEffect(() => {
    const handleUpdate = () => setEnabled(getPrivacyMode());
    window.addEventListener('preferences_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('preferences_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  return enabled;
}

