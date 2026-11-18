import { AlertTriangle, LayoutDashboard, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * @param {{ error?: unknown, onReload: Function, onGoHome: Function, fullScreen?: boolean }} props
 */
export const ErrorFallback = ({ error, onReload, onGoHome, fullScreen = false }) => {
  const content = (
    <Card className="w-full max-w-md">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This page could not be displayed. Your data is safe.
          </p>
        </div>
        {import.meta.env.DEV && error instanceof Error && (
          <p className="max-w-full break-words font-mono text-xs text-muted-foreground">
            {error.message}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onReload}>
            <RotateCw />
            Reload page
          </Button>
          <Button variant="outline" onClick={onGoHome}>
            <LayoutDashboard />
            Go to dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  if (!fullScreen) return content;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      {content}
    </div>
  );
};
