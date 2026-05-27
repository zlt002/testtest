import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

export const Route = createFileRoute('/userscripts/$scriptId')({
  component: LegacyUserScriptDetailRedirect,
});

export function LegacyUserScriptDetailRedirect() {
  const { scriptId } = Route.useParams();
  const navigate = useNavigate();

  React.useEffect(() => {
    void navigate({
      to: '/userscripts',
      search: { scriptId, mode: 'view' } as never,
      replace: true,
    });
  }, [navigate, scriptId]);

  return null;
}
