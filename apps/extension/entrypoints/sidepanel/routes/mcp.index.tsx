import { createFileRoute, redirect } from '@tanstack/react-router';
import { McpRegistryView } from '@/entrypoints/sidepanel/components/mcp-registry/McpRegistryView';
export const McpSettingsContent = () => {
  return <McpRegistryView showHeading={false} contentInset={false} />;
};

export const Route = createFileRoute('/mcp/')({
  beforeLoad: () => {
    throw redirect({
      to: '/settings',
      search: { mode: 'mcp' },
    });
  },
  component: McpSettingsContent,
});
