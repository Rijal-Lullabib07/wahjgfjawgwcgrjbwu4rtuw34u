import { useCallback, useEffect, useState } from 'react';

/**
 * Hook `beforeinstallprompt` — memungkinkan tombol "Pasang App" 1-tap di
 * Android/Chromium. Di iOS tidak ada API setara; user harus lewat menu Share
 * Safari → Add to Home Screen (dipandu di PushSetupModal).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let cachedEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(v: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    cachedEvent = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l(cachedEvent));
  });
  // Event hanya dikirim sekali per kunjungan; bila terlewat (mis. hook
  // dipasang belakangan), baca juga display-mode setelah app terpasang.
  window.addEventListener('appinstalled', () => {
    cachedEvent = null;
    listeners.forEach((l) => l(null));
  });
}

export function useInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(
    () => cachedEvent,
  );

  useEffect(() => {
    const listener = (v: BeforeInstallPromptEvent | null) => setInstallEvent(v);
    listeners.add(listener);
    setInstallEvent(cachedEvent);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!installEvent) return 'unavailable';
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    // Event hanya bisa dipakai sekali — hapus setelah dipakai.
    cachedEvent = null;
    listeners.forEach((l) => l(null));
    return outcome;
  }, [installEvent]);

  return { canInstall: installEvent !== null, promptInstall };
}
