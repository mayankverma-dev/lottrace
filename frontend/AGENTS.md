# LotTrace Frontend — AI Context

> Read this when working in `/frontend`.
> Also read root `AGENTS.md` + `docs/UI_DESIGN_SYSTEM.md` + `docs/API_STANDARDS.md` before writing UI code.

---

## Stack
React 18 + Vite + JavaScript (ES Modules) + Tailwind CSS + shadcn/ui

---

## Critical Frontend Rules

### HTTP — Always Use the Axios Instance
```javascript
// ONLY import from here:
import { api } from '@/lib/api';

// api.js already handles:
// ✅ Base URL (VITE_API_BASE_URL)
// ✅ Authorization: Bearer <token> header injection
// ✅ Automatic token refresh on 401
// ✅ Redirect to /login on 401 after refresh fails

// ❌ NEVER use fetch()
// ❌ NEVER use axios directly (import axios from 'axios')
// ❌ NEVER hardcode the API URL
```

### State — Two Tools, Strict Separation
```
Zustand stores → auth session, UI state (sidebar open/closed, theme)
React Query   → ALL data from the API (lots, events, locations, etc.)
```
```javascript
// ❌ NEVER do this
const useAuthStore = create((set) => ({
  lots: [],                    // API data does NOT belong in Zustand
  setLots: (l) => set({ lots: l }),
}));

// ✅ API data always through React Query
const { data, isLoading } = useGetLots({ page: 1, limit: 20 });
```

### Forms — Always react-hook-form + Zod
```javascript
// ❌ NEVER useState for form fields
const [email, setEmail] = useState('');

// ✅ Always useForm + zodResolver
const { register, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(loginSchema),
});
```

### Icons — Only Lucide
```javascript
// ✅ Correct
import { Package, Truck, MapPin } from 'lucide-react';

// ❌ Never use emoji as icons in UI
// ❌ Never import from heroicons or react-icons
```

---

## Axios Instance (`src/lib/api.js`)

```javascript
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL + '/api/v1',
  withCredentials: true, // for refresh token cookie
});

// Request: inject access token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response: handle 401 → refresh → retry, or redirect to login
let isRefreshing = false;
let queue = [];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => queue.push({ resolve, reject }))
          .then((token) => { original.headers.Authorization = `Bearer ${token}`; return api(original); });
      }
      original._retry = true;
      isRefreshing = true;
      try {
        const { data } = await axios.post(
          import.meta.env.VITE_API_BASE_URL + '/api/v1/auth/refresh',
          {}, { withCredentials: true }
        );
        const newToken = data.data.accessToken;
        useAuthStore.getState().setAccessToken(newToken);
        queue.forEach(({ resolve }) => resolve(newToken));
        queue = [];
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        queue.forEach(({ reject }) => reject());
        queue = [];
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);
```

---

## React Query Patterns

### Query Hook Pattern
```javascript
// api/lots.api.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from 'sonner';

// Query keys — always use these, never raw strings
export const LOTS_KEYS = {
  all:    ['lots'],
  lists:  () => ['lots', 'list'],
  list:   (params) => ['lots', 'list', params],
  detail: (id) => ['lots', 'detail', id],
};

export const useGetLots = (params) => useQuery({
  queryKey: LOTS_KEYS.list(params),
  queryFn: async () => {
    const { data } = await api.get('/lots', { params });
    return data; // { success, data, pagination }
  },
});

export const useGetLot = (lotId) => useQuery({
  queryKey: LOTS_KEYS.detail(lotId),
  queryFn: async () => {
    const { data } = await api.get(`/lots/${lotId}`);
    return data;
  },
  enabled: !!lotId,
});

export const useCreateLot = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post('/lots', payload),
    onSuccess: (_, __, ___, { data }) => {
      queryClient.invalidateQueries({ queryKey: LOTS_KEYS.lists() });
      toast.success('Lot created successfully');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message ?? 'Failed to create lot');
    },
  });
};
```

### queryClient config (`src/lib/queryClient.js`)
```javascript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: (count, err) => count < 2 && err.response?.status !== 404,
    },
  },
});
```

---

## Page Pattern (Always 3 States)

```jsx
// pages/lots/LotsListPage.jsx
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Package } from 'lucide-react';

const LotsListPage = () => {
  const [params, setParams] = useState({ page: 1, limit: 20 });
  const { data, isLoading, isError } = useGetLots(params);

  // 1. Loading
  if (isLoading) return <PageSkeleton />;
  // 2. Error
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  // 3. Empty
  if (!data?.data?.length) return (
    <EmptyState
      icon={Package}
      title="No lots yet"
      description="Create your first lot to start tracking."
      action={<Button onClick={() => navigate('/lots/new')}>Create Lot</Button>}
    />
  );
  // 4. Data
  return (
    <div className="space-y-6">
      <PageHeader title="Lots" action={<Button>Create Lot</Button>} />
      <DataTable
        columns={lotsColumns}
        data={data.data}
        pagination={data.pagination}
        onPaginationChange={setParams}
      />
    </div>
  );
};

export default LotsListPage;
```

---

## Routing Structure (`src/App.jsx`)

```jsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AuthLayout } from './components/layout/AuthLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

// Lazy-load all pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const LotsListPage = lazy(() => import('./pages/lots/LotsListPage'));
// ...

const App = () => (
  <BrowserRouter>
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Auth routes */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/invite/accept" element={<AcceptInvitePage />} />
        </Route>

        {/* App routes (require auth) */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/lots" element={<LotsListPage />} />
          <Route path="/lots/:lotId" element={<LotDetailPage />} />
          <Route path="/events/record" element={<RecordEventPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/trace" element={<TracePage />} />
          <Route path="/trace/:lotId" element={<TraceResultPage />} />
          <Route path="/locations" element={<LocationsListPage />} />
          <Route path="/products" element={<ProductsListPage />} />
          <Route path="/imports" element={<ImportsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/recall" element={<RecallPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/users" element={<UsersPage />} />
          <Route path="/settings/api-keys" element={<ApiKeysPage />} />
          <Route path="/settings/webhooks" element={<WebhooksPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
);
export default App;
```

---

## Error Boundaries and 404

- Every page route renders inside `RouteErrorBoundary` from `AppLayout`. The
  boundary clears itself when the location key changes, so sidebar navigation
  recovers from a bad page without a reload.
- `main.jsx` wraps the app in a root `ErrorBoundary` with a full-screen fallback.
  The root fallback is the last resort for errors outside `AppLayout`.
- Caught render errors are reported through `src/lib/errorReporter.js`. Sentry
  is initialized only when `VITE_SENTRY_DSN` is set; an empty value keeps the
  SDK out of the loaded bundle.
- Unknown routes render `pages/NotFoundPage.jsx` inside the app shell. Do not
  add a plain-text 404 outside the layout.
- `pnpm --filter frontend build` runs `scripts/verify-build.mjs`. Keep the
  React, query, UI, and chart vendor groups in `vite.config.js`; the build fails
  if a group disappears or a size budget is exceeded.

## Sidebar Navigation Items

```javascript
// components/layout/Sidebar.jsx navigation config
const NAV_ITEMS = [
  { label: 'Dashboard',   path: '/dashboard',     icon: LayoutDashboard },
  { label: 'Lots',        path: '/lots',           icon: Package },
  { label: 'Record Event',path: '/events/record',  icon: PlusCircle },
  { label: 'Trace',       path: '/trace',          icon: GitBranch },
  { label: 'Locations',   path: '/locations',      icon: MapPin },
  { label: 'Products',    path: '/products',       icon: Box },
  { label: 'Imports',     path: '/imports',        icon: Upload },
  { label: 'Reports',     path: '/reports',        icon: FileText },
  { label: 'Recall',      path: '/recall',         icon: AlertTriangle },
  { label: 'Audit Log',   path: '/audit',          icon: Shield },
  { label: 'Settings',    path: '/settings',       icon: Settings },
];
```

---

## Permission Checking

```javascript
// hooks/usePermissions.js
import { useAuthStore } from '../stores/auth.store';

const ROLE_PERMISSIONS = {
  org_admin:           ['*'],  // all
  compliance_manager:  ['lots.*', 'events.*', 'trace.*', 'reports.*', 'recall.*', 'audit.read', 'imports.*'],
  operator:            ['lots.read', 'lots.create', 'events.create', 'events.read', 'trace.read'],
  auditor:             ['lots.read', 'events.read', 'trace.read', 'audit.read', 'reports.read'],
};

export const usePermissions = () => {
  const { user } = useAuthStore();
  const can = (permission) => {
    if (!user) return false;
    const perms = ROLE_PERMISSIONS[user.role] ?? [];
    return perms.includes('*') || perms.includes(permission) ||
      perms.some(p => p.endsWith('.*') && permission.startsWith(p.slice(0, -2)));
  };
  return { can, role: user?.role };
};

// Usage in component:
const { can } = usePermissions();
{can('events.create') && <Button>Record Event</Button>}
```

---

## `cn` Utility (Required for shadcn)

```javascript
// src/lib/utils.js
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs) => twMerge(clsx(inputs));
```

---

## Path Aliases (vite.config.js)

```javascript
// All imports use @/ alias for src/
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

// vite.config.js sets:
// resolve: { alias: { '@': path.resolve(__dirname, './src') } }
```

---

## Toast Notifications

```javascript
// Always use sonner — imported at app level
import { Toaster } from 'sonner';
// In App.jsx: <Toaster position="top-right" richColors />

// In components:
import { toast } from 'sonner';
toast.success('Lot created');
toast.error('Failed to save — please try again');
toast.info('Import processing in background...');
```

---

## Date Display Rules

```javascript
// utils/formatDate.js
import { format, formatDistance } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Display event datetime in location's timezone
export const formatEventDate = (isoString, timezone = 'UTC') => {
  const zoned = toZonedTime(new Date(isoString), timezone);
  return format(zoned, 'MMM d, yyyy h:mm a zzz');
};

// Relative time for feeds
export const timeAgo = (isoString) =>
  formatDistance(new Date(isoString), new Date(), { addSuffix: true });

// Always show the unit next to quantity
export const formatQuantity = (quantity, uom) =>
  `${Number(quantity).toLocaleString()} ${uom}`;
```
