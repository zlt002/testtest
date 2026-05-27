import { z } from 'zod';
import { t } from './router';

const USER_SCRIPTS_UNAVAILABLE_MESSAGE =
  'userScripts API is not available. Please enable "Allow User Scripts" in extension details, or turn on Developer mode in older Chrome versions.';

function getUserScriptsApiOrThrow() {
  if (!chrome.userScripts) {
    throw new Error(USER_SCRIPTS_UNAVAILABLE_MESSAGE);
  }

  return chrome.userScripts;
}

/**
 * userScriptRouter:
 * A tRPC router that provides procedures for managing UserScripts
 * using Chrome's native userScripts API instead of a database.
 */
export const userScriptRouter = t.router({
  // ========== UserScript Management using Chrome API ==========

  /**
   * Register a new UserScript using Chrome's userScripts API
   */
  registerScript: t.procedure
    .input(
      z.object({
        id: z.string(),
        matches: z.array(z.string()),
        js: z.array(z.union([z.object({ code: z.string() }), z.object({ file: z.string() })])),
        excludeMatches: z.array(z.string()).optional(),
        excludeGlobs: z.array(z.string()).optional(),
        includeGlobs: z.array(z.string()).optional(),
        allFrames: z.boolean().optional(),
        runAt: z.enum(['document_start', 'document_end', 'document_idle']).optional(),
        world: z.enum(['MAIN', 'USER_SCRIPT']).optional(),
        worldId: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      try {
        const userScriptsApi = getUserScriptsApiOrThrow();
        // First check if script with this ID already exists
        const existingScripts = await userScriptsApi.getScripts({ ids: [input.id] });

        // Unregister if it exists
        if (existingScripts.length > 0) {
          await userScriptsApi.unregister({ ids: [input.id] });
        }

        // Register the new script
        await userScriptsApi.register([
          {
            id: input.id,
            matches: input.matches,
            js: input.js,
            excludeMatches: input.excludeMatches,
            excludeGlobs: input.excludeGlobs,
            includeGlobs: input.includeGlobs,
            allFrames: input.allFrames,
            runAt: input.runAt,
            world: input.world,
            worldId: input.worldId,
          },
        ]);

        // Save the script code to chrome.storage for persistence
        if (input.js.length > 0 && 'code' in input.js[0]) {
          const storageKey = `webmcp:userscripts:${input.id}`;
          await chrome.storage.local.set({ [storageKey]: input.js[0].code });
        }

        return { success: true };
      } catch (error) {
        console.error('Failed to register userscript:', error);
        throw error;
      }
    }),

  /**
   * Test execute a userscript without registering it
   * Uses chrome.userScripts.execute() API (Chrome 135+)
   */
  testExecuteScript: t.procedure
    .input(
      z.object({
        code: z.string(),
        tabId: z.number(),
        frameIds: z.array(z.number()).optional(),
        allFrames: z.boolean().optional(),
        documentIds: z.array(z.string()).optional(),
        world: z.enum(['MAIN', 'USER_SCRIPT']).optional(),
        worldId: z.string().optional(),
        injectImmediately: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }): Promise<{ results: any[] }> => {
      try {
        const userScriptsApi = getUserScriptsApiOrThrow();
        // Use chrome.userScripts.execute for testing scripts
        if (typeof userScriptsApi.execute !== 'function') {
          throw new Error(
            `${USER_SCRIPTS_UNAVAILABLE_MESSAGE} Additionally, script execution requires Chrome 135+.`
          );
        }

        const results = await userScriptsApi.execute({
          target: {
            tabId: input.tabId,
            frameIds: input.frameIds,
            allFrames: input.allFrames,
            documentIds: input.documentIds,
          },
          js: [{ code: input.code }],
          world: input.world || 'USER_SCRIPT',
          worldId: input.worldId,
          injectImmediately: input.injectImmediately,
        });

        return { results };
      } catch (error) {
        console.error('Failed to execute test userscript:', error);
        throw error;
      }
    }),

  /**
   * Get a specific UserScript by ID
   */
  getScript: t.procedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ input }) => {
      const userScriptsApi = getUserScriptsApiOrThrow();
      const scripts = await userScriptsApi.getScripts({ ids: [input.id] });

      if (scripts.length > 0) {
        const script = scripts[0];

        // Try to load the saved code from storage
        const storageKey = `webmcp:userscripts:${input.id}`;
        const stored = await chrome.storage.local.get(storageKey);
        const savedCode = stored[storageKey];

        return {
          ...script,
          savedCode: savedCode || null,
        };
      }

      return null;
    }),

  /**
   * Get all registered UserScripts
   */
  getAllScripts: t.procedure.query(async () => {
    const userScriptsApi = getUserScriptsApiOrThrow();
    const scripts = await userScriptsApi.getScripts();
    return scripts;
  }),

  /**
   * Update a UserScript
   */
  updateScript: t.procedure
    .input(
      z.object({
        id: z.string(),
        updates: z.object({
          matches: z.array(z.string()).optional(),
          js: z
            .array(z.union([z.object({ code: z.string() }), z.object({ file: z.string() })]))
            .optional(),
          excludeMatches: z.array(z.string()).optional(),
          excludeGlobs: z.array(z.string()).optional(),
          includeGlobs: z.array(z.string()).optional(),
          allFrames: z.boolean().optional(),
          runAt: z.enum(['document_start', 'document_end', 'document_idle']).optional(),
          world: z.enum(['MAIN', 'USER_SCRIPT']).optional(),
          worldId: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      try {
        const userScriptsApi = getUserScriptsApiOrThrow();
        // Get existing script
        const existingScripts = await userScriptsApi.getScripts({ ids: [input.id] });
        if (existingScripts.length === 0) {
          throw new Error('Script not found');
        }

        const existingScript = existingScripts[0];

        // Merge updates with existing script
        const updatedScript = {
          ...existingScript,
          ...input.updates,
        };

        // Update by unregistering and re-registering
        await userScriptsApi.update([updatedScript]);

        // If JS code was updated, save it to storage
        if (input.updates.js && input.updates.js.length > 0 && 'code' in input.updates.js[0]) {
          const storageKey = `webmcp:userscripts:${input.id}`;
          await chrome.storage.local.set({ [storageKey]: input.updates.js[0].code });
        }

        return { success: true };
      } catch (error) {
        console.error('Failed to update userscript:', error);
        throw error;
      }
    }),

  /**
   * Delete/unregister a UserScript
   */
  deleteScript: t.procedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      try {
        const userScriptsApi = getUserScriptsApiOrThrow();
        await userScriptsApi.unregister({ ids: [input.id] });

        // Clean up stored code from chrome.storage
        const storageKey = `webmcp:userscripts:${input.id}`;
        await chrome.storage.local.remove(storageKey);

        return { success: true };
      } catch (error) {
        console.error('Failed to delete userscript:', error);
        throw error;
      }
    }),

  /**
   * Delete all UserScripts
   */
  deleteAllScripts: t.procedure.mutation(async (): Promise<{ success: boolean }> => {
    try {
      const userScriptsApi = getUserScriptsApiOrThrow();
      await userScriptsApi.unregister();

      // Clean up all userscript code from storage
      const allStorage = await chrome.storage.local.get();
      const userscriptKeys = Object.keys(allStorage).filter((key) =>
        key.startsWith('webmcp:userscripts:')
      );
      if (userscriptKeys.length > 0) {
        await chrome.storage.local.remove(userscriptKeys);
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to delete all userscripts:', error);
      throw error;
    }
  }),

  // ========== World Configuration ==========

  /**
   * Configure the USER_SCRIPT world settings
   */
  configureWorld: t.procedure
    .input(
      z.object({
        worldId: z.string().optional(),
        csp: z.string().optional(),
        messaging: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      try {
        const userScriptsApi = getUserScriptsApiOrThrow();
        await userScriptsApi.configureWorld({
          worldId: input.worldId,
          csp: input.csp,
          messaging: input.messaging,
        });
        return { success: true };
      } catch (error) {
        console.error('Failed to configure world:', error);
        throw error;
      }
    }),

  /**
   * Get all world configurations
   */
  getWorldConfigurations: t.procedure.query(async () => {
    try {
      const userScriptsApi = getUserScriptsApiOrThrow();
      const worlds = await userScriptsApi.getWorldConfigurations();
      return worlds;
    } catch (error) {
      console.error('Failed to get world configurations:', error);
      throw error;
    }
  }),

  /**
   * Reset world configuration
   */
  resetWorldConfiguration: t.procedure
    .input(
      z.object({
        worldId: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      try {
        const userScriptsApi = getUserScriptsApiOrThrow();
        await userScriptsApi.resetWorldConfiguration(input.worldId);
        return { success: true };
      } catch (error) {
        console.error('Failed to reset world configuration:', error);
        throw error;
      }
    }),

  // ========== Import/Export ==========

  /**
   * Import multiple UserScripts at once
   */
  importScripts: t.procedure
    .input(
      z.object({
        scripts: z.array(
          z.object({
            id: z.string(),
            matches: z.array(z.string()),
            js: z.array(z.union([z.object({ code: z.string() }), z.object({ file: z.string() })])),
            excludeMatches: z.array(z.string()).optional(),
            excludeGlobs: z.array(z.string()).optional(),
            includeGlobs: z.array(z.string()).optional(),
            allFrames: z.boolean().optional(),
            runAt: z.enum(['document_start', 'document_end', 'document_idle']).optional(),
            world: z.enum(['MAIN', 'USER_SCRIPT']).optional(),
            worldId: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }): Promise<{ imported: number; failed: number }> => {
      const userScriptsApi = getUserScriptsApiOrThrow();
      let imported = 0;
      let failed = 0;

      for (const script of input.scripts) {
        try {
          // Check if script exists and unregister it
          const existing = await userScriptsApi.getScripts({ ids: [script.id] });
          if (existing.length > 0) {
            await userScriptsApi.unregister({ ids: [script.id] });
          }

          // Register the script
          await userScriptsApi.register([script]);
          imported++;
        } catch (error) {
          console.error(`Failed to import script ${script.id}:`, error);
          failed++;
        }
      }

      return { imported, failed };
    }),

  /**
   * Export all UserScripts
   */
  exportScripts: t.procedure.query(async () => {
    const userScriptsApi = getUserScriptsApiOrThrow();
    const scripts = await userScriptsApi.getScripts();
    return { scripts };
  }),

  // ========== Utility Functions ==========

  /**
   * Check if userScripts API is available
   */
  checkApiAvailability: t.procedure.query(
    async (): Promise<{ available: boolean; message?: string }> => {
      try {
        // Try to call getScripts to check if API is enabled
        const userScriptsApi = getUserScriptsApiOrThrow();
        await userScriptsApi.getScripts();
        return { available: true };
      } catch (error) {
        // API not available or toggle not enabled
        return {
          available: false,
          message: USER_SCRIPTS_UNAVAILABLE_MESSAGE,
        };
      }
    }
  ),

  /**
   * Get Chrome version to determine which toggle is required
   */
  getChromeVersion: t.procedure.query(
    async (): Promise<{ version: number; toggleType: string }> => {
      const match = navigator.userAgent.match(/(Chrome|Chromium)\/([0-9]+)/);
      const version = match ? Number(match[2]) : 0;
      const toggleType = version >= 138 ? 'Allow User Scripts' : 'Developer mode';

      return { version, toggleType };
    }
  ),

  /**
   * Search scripts by matching pattern
   */
  searchScripts: t.procedure
    .input(
      z.object({
        pattern: z.string(),
      })
    )
    .query(async ({ input }) => {
      const userScriptsApi = getUserScriptsApiOrThrow();
      const allScripts = await userScriptsApi.getScripts();
      const pattern = input.pattern.toLowerCase();

      return allScripts.filter(
        (script) =>
          script.id.toLowerCase().includes(pattern) ||
          script.matches?.some((match) => match.toLowerCase().includes(pattern))
      );
    }),

  /**
   * Get scripts that match a specific URL
   */
  getScriptsForUrl: t.procedure
    .input(
      z.object({
        url: z.string(),
      })
    )
    .query(async ({ input }) => {
      const userScriptsApi = getUserScriptsApiOrThrow();
      const allScripts = await userScriptsApi.getScripts();

      // This is a simplified check - in production you'd want to properly
      // match patterns according to Chrome's pattern matching rules
      return allScripts.filter((script) => {
        if (!script.matches) return false;

        return script.matches.some((pattern) => {
          // Convert Chrome match pattern to regex (simplified)
          const regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.')
            .replace(/\//g, '\\/');

          try {
            const regex = new RegExp(regexPattern);
            return regex.test(input.url);
          } catch {
            return false;
          }
        });
      });
    }),
});
