import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { SessionUser } from './types';
import { clearSession, loadSession, saveSession } from './lib/session';
import { loginAdmin, loginRegu, logout } from './lib/supabase/api';
import { installOnlineListener } from './lib/offline-sync/syncManager';
import LoginPage from './features/auth/LoginPage';
import InstallGate from './features/auth/InstallGate';
import SplashScreen from './features/splash/SplashScreen';
import ReguApp from './features/regu-capture/ReguApp';
import AdminApp from './features/admin-dashboard/AdminApp';

/**
 * App shell: routing role-based sederhana.
 * - Regu  → InstallGate (iOS) → ReguApp
 * - Admin → AdminApp
 * Session persisten di localStorage (satu smartphone = satu sesi).
 */
export default function App() {
  const [session, setSession] = useState<SessionUser | null>(() => loadSession());
  const [booting, setBooting] = useState(true);

  useEffect(() => installOnlineListener(), []);

  useEffect(() => {
    // beri waktu register SW / restore sesi
    const t = setTimeout(() => setBooting(false), 400);
    return () => clearTimeout(t);
  }, []);

  const handleLoginRegu = async (kode: string, pin: string) => {
    const s = await loginRegu(kode, pin);
    saveSession(s);
    setSession(s);
  };

  const handleLoginAdmin = async (email: string, password: string) => {
    const s = await loginAdmin(email, password);
    saveSession(s);
    setSession(s);
  };

  const handleLogout = async () => {
    await logout();
    clearSession();
    setSession(null);
  };

  if (booting) {
    return <SplashScreen />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            session ? (
              <Navigate to={session.role === 'regu' ? '/' : '/admin'} replace />
            ) : (
              <LoginPage onLoginRegu={handleLoginRegu} onLoginAdmin={handleLoginAdmin} />
            )
          }
        />
        <Route
          path="/*"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : session.role === 'regu' ? (
              <InstallGate>
                <ReguApp session={session} onLogout={handleLogout} />
              </InstallGate>
            ) : (
              <AdminApp session={session} onLogout={handleLogout} />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
