import { useEffect, useState } from 'react';
import type { SessionUser } from '../types';

const KEY = 'siplap_session_v1';

export function saveSession(session: SessionUser): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function loadSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

/**
 * Deteksi PWA sudah di-install ke homescreen (wajib di iOS agar push jalan).
 * Mengembalikan null bila tidak bisa dideteksi (mis. browser desktop).
 */
export function useIsStandalone(): boolean | null {
  const [standalone, setStandalone] = useState<boolean | null>(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
    return mq.matches || iosStandalone === true;
  });

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const onChange = (e: MediaQueryListEvent) => setStandalone(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return standalone;
}

export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
