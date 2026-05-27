import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

export const Route = createFileRoute('/userscripts/new')({
  component: LegacyNewUserScriptRedirect,
});

export function LegacyNewUserScriptRedirect() {
  const navigate = useNavigate();

  React.useEffect(() => {
    void navigate({
      to: '/userscripts',
      search: { mode: 'create' } as never,
      replace: true,
    });
  }, [navigate]);

  return null;
}
