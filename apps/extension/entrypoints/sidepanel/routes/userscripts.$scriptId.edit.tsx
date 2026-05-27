import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

export const Route = createFileRoute('/userscripts/$scriptId/edit')({
  component: LegacyEditUserScriptRedirect,
});

export function LegacyEditUserScriptRedirect() {
  const { scriptId } = Route.useParams();
  const navigate = useNavigate();

  React.useEffect(() => {
    void navigate({
      to: '/userscripts',
      search: { scriptId, mode: 'edit' } as never,
      replace: true,
    });
  }, [navigate, scriptId]);

  return null;
}
