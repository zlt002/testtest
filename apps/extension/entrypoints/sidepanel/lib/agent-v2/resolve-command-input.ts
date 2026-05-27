import type { CommandCatalog, CommandCatalogEntry, CommandExecutionResult } from './types';

function flattenCommands(catalog: CommandCatalog): CommandCatalogEntry[] {
  return [
    ...catalog.localUi,
    ...catalog.project,
    ...catalog.user,
    ...catalog.plugin,
    ...catalog.skills,
  ];
}

export async function resolveCommandInput(
  content: string,
  input: {
    projectPath?: string;
    listCommands: (options?: {
      projectPath?: string;
      forceRefresh?: boolean;
    }) => Promise<CommandCatalog>;
    executeCommand: (options: {
      commandName: string;
      commandPath?: string;
      args?: string[];
      context?: { projectPath?: string };
    }) => Promise<CommandExecutionResult>;
    onLocalCommand?: (command: CommandCatalogEntry) => void;
  }
): Promise<string | null> {
  if (!content.startsWith('/')) {
    return content;
  }

  const [commandName, ...args] = content.split(/\s+/);
  const catalog = await input.listCommands({ projectPath: input.projectPath });
  const command = flattenCommands(catalog).find((item) => item.name === commandName);
  if (!command) {
    return content;
  }

  if (command.metadata?.type === 'local-ui') {
    input.onLocalCommand?.(command);
    return null;
  }

  if ((command.metadata?.type === 'custom' || command.metadata?.type === 'skill') && command.path) {
    const result = await input.executeCommand({
      commandName,
      commandPath: command.path,
      args,
      context: { projectPath: input.projectPath },
    });
    return result.type === 'custom' ? result.content : content;
  }

  return content;
}
