import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { AlertCircle, FileQuestion } from 'lucide-react';
import { Toaster } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';

export const Route = createRootRouteWithContext<Record<string, never>>()({
  component: RootComponent,
  notFoundComponent: () => (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <Alert variant="destructive" className="max-w-md mb-4">
        <FileQuestion className="h-5 w-5 mr-2" />
        <AlertTitle>Page Not Found</AlertTitle>
        <AlertDescription>
          The page you're looking for doesn't exist or has been moved.
        </AlertDescription>
      </Alert>
      <Button asChild>
        <Link to="/chat">Return Home</Link>
      </Button>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <Alert variant="destructive" className="max-w-md mb-4">
        <AlertCircle className="h-5 w-5 mr-2" />
        <AlertTitle>Something went wrong!</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : 'An unknown error occurred'}
        </AlertDescription>
      </Alert>
      <Button asChild>
        <Link to="/chat">Return Home</Link>
      </Button>
    </div>
  ),
});

export function RootComponent() {
  return (
    <>
      <div className="flex flex-col h-screen">
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </>
  );
}
