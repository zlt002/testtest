import { createFileRoute } from '@tanstack/react-router';
import { UserScriptsWorkspace } from './userscripts.workspace';

export const Route = createFileRoute('/userscripts/')({
  component: UserscriptsWorkspaceRoute,
});

export function UserscriptsWorkspaceRoute() {
  const search = Route.useSearch() as {
    mode?: 'view' | 'edit' | 'create';
    scriptId?: string;
  };

  return <UserScriptsWorkspace routeMode={search.mode} routeScriptId={search.scriptId} />;
}
