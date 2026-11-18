import { Sidebar } from './Sidebar';
import { Outlet } from 'react-router-dom';
import { NotificationBell } from '../notifications/NotificationBell';
import { RouteErrorBoundary } from './RouteErrorBoundary';

export const AppLayout = () => {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto flex flex-col">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-end px-6 shrink-0 shadow-sm z-10">
          <NotificationBell />
        </header>
        <div className="p-6 space-y-6 flex-1 overflow-auto">
          <RouteErrorBoundary>
            <Outlet />
          </RouteErrorBoundary>
        </div>
      </main>
    </div>
  );
};
