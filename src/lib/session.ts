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

export type Platform = 'ios' | 'android' | 'desktop';

interface NavigatorUAData {
  platform?: string;
  mobile?: boolean;
}

/**
 * Deteksi Android — WAJIB dicek DULU sebelum iOS.
 *
 * Sebagian browser/WebView Android melaporkan `navigator.platform` yang aneh
 * (mis. "MacIntel"), sehingga pengecekan iOS lama sering SALAH menebak Android
 * sebagai iPhone. `navigator.userAgentData.platform` (Chromium modern) adalah
 * sinyal paling andal; fallback ke UA string.
 */
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData })
    .userAgentData;
  if (uaData?.platform) return /android/i.test(uaData.platform);
  return /Android|Adr/i.test(navigator.userAgent || '');
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Android tidak pernah iOS, walau platform/maxTouchPoints menipu.
  if (isAndroid()) return false;
  const ua = navigator.userAgent || '';
  if (/Android|Adr/i.test(ua)) return false;
  // iPadOS 13+ menyamar sebagai Mac desktop dengan layar sentuh.
  const iPadOS13Plus =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS13Plus;
}

/** Platform gabungan untuk menentukan pesan & panduan yang tampil. */
export function getPlatform(): Platform {
  if (isAndroid()) return 'android';
  if (isIOS()) return 'ios';
  return 'desktop';
}

/** PWA sudah terpasang ke home screen? (snapshot sinkron) */
export function isStandaloneNow(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)');
  const iosStandalone = (navigator as unknown as { standalone?: boolean })
    .standalone;
  return Boolean(mq?.matches) || iosStandalone === true;
}

/**
 * Deteksi PWA sudah di-install ke homescreen (wajib di iOS agar push jalan).
 * Ikut berubah saat user memasang app (event `appinstalled`).
 */
export function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState<boolean>(isStandaloneNow);

  useEffect(() => {
    const onChange = () => setStandalone(isStandaloneNow());
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', onChange);
    window.addEventListener('appinstalled', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('appinstalled', onChange);
    };
  }, []);

  return standalone;
}
