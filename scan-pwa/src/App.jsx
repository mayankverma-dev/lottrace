import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { ScanLine, Clock, Keyboard } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { queryClient } from './lib/queryClient';
import { clearSessionData } from './lib/session';
import { useAuthStore } from './stores/auth.store';
import { useEffect } from 'react';
import { apiClient } from './lib/api';
import { logoutApi } from './api/auth.api';
import ScanPage from '@/pages/ScanPage';
import LoginPage from '@/pages/auth/LoginPage';

const SCAN_NAV = [
  { label: 'Scan',    path: '/scan',     icon: ScanLine },
  { label: 'History', path: '/history',  icon: Clock },
  { label: 'Manual',  path: '/manual',   icon: Keyboard },
];

function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex h-16 items-center justify-around border-t bg-background pb-[env(safe-area-inset-bottom)]">
      {SCAN_NAV.map((item) => {
        const Icon = item.icon;
        const isActive =
          location.pathname.startsWith(item.path) ||
          (item.path === '/scan' && location.pathname === '/');

        return (
          <Link
            key={item.path}
            to={item.path}
            className={[
              'flex flex-col items-center justify-center w-full h-full min-h-[44px] gap-1 text-xs font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground',
            ].join(' ')}
          >
            <Icon className="size-5" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AppHeader() {
  const { user } = useAuthStore();

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {
      // ignore — clear local state regardless
    } finally {
      await clearSessionData();
    }
  };

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-3 shadow-sm">
      <h1 className="text-lg font-bold tracking-tight text-foreground">LotTrace</h1>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block size-2 rounded-full bg-emerald-500" />
          Online
        </span>
        {user && (
          <button
            onClick={handleLogout}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

const ProtectedRoute = ({ children }) => {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return children;
};

function Layout() {
  return (
    <div className="flex flex-col min-h-screen bg-background pb-16">
      <AppHeader />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<ProtectedRoute><ScanPage /></ProtectedRoute>} />
          <Route path="/scan" element={<ProtectedRoute><ScanPage /></ProtectedRoute>} />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <div className="p-6 text-center text-muted-foreground mt-10">History coming soon</div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/manual"
            element={
              <ProtectedRoute>
                <div className="p-6 text-center text-muted-foreground mt-10">Manual entry coming soon</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}

export default function App() {
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const initAuth = async () => {
      const isAuthenticated = localStorage.getItem('isAuthenticated');
      if (!isAuthenticated) {
        await clearSessionData();
        return;
      }
      try {
        // Use apiClient (not the api instance) to bypass response interceptors
        // during boot, but still include base configuration (like ngrok headers).
        const { data } = await apiClient.post('/auth/refresh');
        const { user, accessToken } = data.data;
        setAuth(user, accessToken);
      } catch {
        await clearSessionData();
      }
    };
    initAuth();
  }, [setAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="top-center" richColors />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<Layout />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
