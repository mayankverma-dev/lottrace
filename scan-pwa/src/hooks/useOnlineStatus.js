import { useEffect, useState } from 'react';

/**
 * Tracks the browser connection state so the PWA never claims to be online
 * while submissions cannot reach the API.
 *
 * @returns {boolean}
 */
export const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return isOnline;
};
