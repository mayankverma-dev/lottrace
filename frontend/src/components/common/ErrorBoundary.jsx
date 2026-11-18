import { Component } from 'react';
import { ErrorFallback } from './ErrorFallback';
import { reportClientError } from '@/lib/errorReporter';

/**
 * Catches render and lifecycle errors in its subtree. A resetKey change
 * clears the error so navigation can recover without a full reload.
 *
 * @typedef {{
 *   children?: import('react').ReactNode,
 *   fallback?: import('react').ReactNode | ((args: { error: Error, reset: Function }) => import('react').ReactNode),
 *   resetKey?: unknown,
 *   onReset?: Function,
 * }} ErrorBoundaryProps
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    reportClientError(error, { componentStack: errorInfo?.componentStack ?? null });
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.handleReset();
    }
  }

  handleReset() {
    if (this.state.error) this.setState({ error: null });
    this.props.onReset?.();
  }

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;

    if (typeof fallback === 'function') {
      return fallback({ error, reset: this.handleReset });
    }

    if (fallback) return fallback;

    return (
      <ErrorFallback
        error={error}
        onReload={() => window.location.reload()}
        onGoHome={() => window.location.assign('/dashboard')}
      />
    );
  }
}
