import { useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ErrorFallback } from '@/components/common/ErrorFallback';

/**
 * Route-level boundary. The location key changes on navigation, which clears
 * the caught error and lets the user reach a working page without a reload.
 *
 * @param {{ children?: import('react').ReactNode }} props
 */
export const RouteErrorBoundary = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <ErrorBoundary
      resetKey={location.key}
      fallback={({ error, reset }) => (
        <ErrorFallback
          error={error}
          onReload={() => window.location.reload()}
          onGoHome={() => {
            reset();
            navigate('/dashboard');
          }}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
};
