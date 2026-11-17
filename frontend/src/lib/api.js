import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const config = {
  baseURL: import.meta.env.VITE_API_BASE_URL + '/api/v1',
  withCredentials: true, // for refresh token cookie
  headers: {
    'ngrok-skip-browser-warning': 'true',
  },
};

// Base client without interceptors, useful for auth operations (login/refresh)
export const apiClient = axios.create(config);

// Main client with interceptors
export const api = axios.create(config);

const REFRESH_LOCK_KEY = 'lottrace-auth-refresh-lock';
const REFRESH_CHANNEL_NAME = 'lottrace-auth-refresh';
const REFRESH_LOCK_MS = 15000;
const REFRESH_WAIT_MS = 20000;
const refreshTabId = Math.random().toString(36).slice(2);
const refreshChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(REFRESH_CHANNEL_NAME)
  : null;

const readRefreshLock = () => {
  try {
    const lock = JSON.parse(window.localStorage.getItem(REFRESH_LOCK_KEY));
    if (!lock || lock.expiresAt <= Date.now()) return null;
    return lock;
  } catch (_error) {
    return null;
  }
};

const tryAcquireRefreshLock = () => {
  const current = readRefreshLock();
  if (current && current.owner !== refreshTabId) return false;
  window.localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({
    owner: refreshTabId,
    expiresAt: Date.now() + REFRESH_LOCK_MS,
  }));
  return readRefreshLock()?.owner === refreshTabId;
};

const releaseRefreshLock = () => {
  if (readRefreshLock()?.owner === refreshTabId) {
    window.localStorage.removeItem(REFRESH_LOCK_KEY);
  }
};

const waitForCrossTabRefresh = () => new Promise((resolve, reject) => {
  if (!refreshChannel) {
    reject(new Error('Cross-tab refresh channel unavailable'));
    return;
  }

  let settled = false;
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    refreshChannel.removeEventListener('message', onMessage);
    window.clearTimeout(timeout);
    callback(value);
  };
  const onMessage = (event) => {
    if (event.data?.type !== 'refresh-result') return;
    if (event.data.ok) finish(resolve, event.data.payload);
    else finish(reject, event.data.error);
  };
  const timeout = window.setTimeout(() => {
    finish(reject, new Error('Timed out waiting for another tab to refresh'));
  }, REFRESH_WAIT_MS);

  refreshChannel.addEventListener('message', onMessage);
});

const refreshAccessToken = async () => {
  if (typeof window === 'undefined' || !refreshChannel || tryAcquireRefreshLock()) {
    try {
      const { data } = await apiClient.post('/auth/refresh');
      const payload = data.data;
      refreshChannel?.postMessage({ type: 'refresh-result', ok: true, payload });
      return payload;
    } catch (error) {
      refreshChannel?.postMessage({
        type: 'refresh-result',
        ok: false,
        error: error.response?.data || { message: error.message },
      });
      throw error;
    } finally {
      releaseRefreshLock();
    }
  }

  return waitForCrossTabRefresh();
};

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

    // Do not intercept 401s for login or refresh itself
    if (
      !original ||
      original.url?.includes('/auth/login') ||
      original.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => queue.push({ resolve, reject }))
          .then((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            return api(original);
          })
          .catch(() => Promise.reject(error));
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const { user, accessToken: newToken } = await refreshAccessToken();
        
        useAuthStore.getState().setAuth(user, newToken);
        
        queue.forEach(({ resolve }) => resolve(newToken));
        queue = [];
        
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        queue.forEach(({ reject }) => reject(refreshError));
        queue = [];
        
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
        
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
