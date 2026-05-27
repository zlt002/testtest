import type {
  SystemUpdateInfo,
  SystemUpdateStartResponse,
} from '@/entrypoints/sidepanel/lib/agent-v2/types';
import { useSystemUpdateCheck } from '@/entrypoints/sidepanel/lib/agent-v2/useSystemUpdateCheck';
import { SystemUpdateNotice } from './SystemUpdateNotice';

type SystemUpdateClient = {
  getSystemUpdateInfo(): Promise<SystemUpdateInfo>;
  startSystemUpdate(): Promise<SystemUpdateStartResponse>;
};

type SystemUpdateEntryProps = {
  client: SystemUpdateClient;
};

export function SystemUpdateEntry({ client }: SystemUpdateEntryProps) {
  const systemUpdate = useSystemUpdateCheck(client);

  return (
    <SystemUpdateNotice
      info={systemUpdate.info}
      loading={systemUpdate.loading}
      onStartUpdate={() => client.startSystemUpdate()}
      onPollUpdateInfo={() => client.getSystemUpdateInfo()}
    />
  );
}
