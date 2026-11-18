let sentryClient = null;
let initialized = false;

/**
 * Normalizes an unknown error into a plain report object safe to send to
 * error tracking. Never includes request bodies or user-supplied data.
 *
 * @param {unknown} error
 * @param {{ componentStack?: string|null, url?: string|null }} [context]
 * @returns {{ name: string, message: string, stack: string|null, componentStack: string|null, url: string|null }}
 */
export const buildErrorReport = (error, context = {}) => {
  const isError = error instanceof Error;
  const fallbackUrl = typeof window !== 'undefined' ? window.location.href : null;

  return {
    name: isError ? error.name : typeof error,
    message: isError ? error.message : String(error ?? 'Unknown error'),
    stack: isError ? error.stack ?? null : null,
    componentStack: context.componentStack ?? null,
    url: context.url ?? fallbackUrl,
  };
};

/**
 * Builds a reporter with an injectable client so the reporting path can be
 * tested without a browser or a Sentry DSN.
 *
 * @param {{ getClient?: () => ({ captureException: Function } | null), logger?: Pick<Console, 'error'|'warn'> }} [options]
 * @returns {{ report: (error: unknown, context?: Object) => Object }}
 */
export const createErrorReporter = ({
  getClient = () => sentryClient,
  logger = console,
} = {}) => ({
  report(error, context = {}) {
    const report = buildErrorReport(error, context);

    logger.error?.('[error-boundary]', report.message);

    try {
      const client = getClient();
      if (client) client.captureException(error, { extra: report });
    } catch (reportError) {
      logger.warn?.('[error-boundary] failed to report error', reportError);
    }

    return report;
  },
});

const reporter = createErrorReporter();

/**
 * Sends a render error to Sentry when configured. Reporting failures never
 * affect the rendered fallback.
 *
 * @param {unknown} error
 * @param {{ componentStack?: string|null, url?: string|null }} [context]
 */
export const reportClientError = (error, context = {}) => reporter.report(error, context);

/**
 * Initializes browser Sentry only when VITE_SENTRY_DSN is set. The SDK is
 * dynamically imported so an unconfigured build never loads it.
 *
 * @param {{ loader?: () => Promise<Object> }} [options]
 * @returns {Promise<Object|null>}
 */
export const initErrorReporting = async ({ loader = () => import('@sentry/react') } = {}) => {
  if (initialized) return sentryClient;
  initialized = true;

  const dsn = import.meta.env?.VITE_SENTRY_DSN;
  if (!dsn) return null;

  try {
    const Sentry = await loader();
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
    });
    sentryClient = Sentry;
    return Sentry;
  } catch (error) {
    console.warn('[error-reporter] Sentry initialization failed', error);
    return null;
  }
};
