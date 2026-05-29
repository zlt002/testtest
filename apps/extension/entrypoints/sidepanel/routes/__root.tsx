import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { AlertCircle, FileQuestion } from 'lucide-react';
import { Toaster } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { localizeUserFacingError } from '../lib/user-facing-error';

export const Route = createRootRouteWithContext<Record<string, never>>()({
  component: RootComponent,
  notFoundComponent: () => (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <Alert variant="destructive" className="max-w-md mb-4">
        <FileQuestion className="h-5 w-5 mr-2" />
        <AlertTitle>页面不存在</AlertTitle>
        <AlertDescription>你访问的页面不存在，或已被移动。</AlertDescription>
      </Alert>
      <Button asChild>
        <Link to="/chat">返回首页</Link>
      </Button>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <Alert variant="destructive" className="max-w-md mb-4">
        <AlertCircle className="h-5 w-5 mr-2" />
        <AlertTitle>出现异常</AlertTitle>
        <AlertDescription>{localizeUserFacingError(error, '发生未知错误')}</AlertDescription>
      </Alert>
      <Button asChild>
        <Link to="/chat">返回首页</Link>
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
