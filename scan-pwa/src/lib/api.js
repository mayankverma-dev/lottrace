import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';
import { clearSessionData } from './session';

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
        const { data } = await apiClient.post('/auth/refresh');
        const { user, accessToken: newToken } = data.data;
        
        useAuthStore.getState().setAuth(user, newToken);
        
        queue.forEach(({ resolve }) => resolve(newToken));
        queue = [];
        
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        queue.forEach(({ reject }) => reject(refreshError));
        queue = [];
        
        await clearSessionData();
        window.location.href = '/login';
        
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
