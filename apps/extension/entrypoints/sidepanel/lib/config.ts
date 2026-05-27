/**
 * Extension configuration management with Zod validation
 * Handles environment variables and provides typed access to configuration values
 */

import { z } from 'zod';

/**
 * Configuration schema using Zod
 */
const ConfigSchema = z.object({
  api: z.object({
    agentV2BaseUrl: z.string().url('Agent V2 base URL must be a valid URL'),
    agentV2Endpoint: z.string().min(1, 'Agent V2 endpoint cannot be empty'),
    fullAgentV2Url: z.string().url('Agent V2 API URL must be a valid URL'),
  }),
  features: z.object({
    enableDebugLogging: z.boolean(),
    maxChatSteps: z.number().int().min(1).max(100),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Get environment variable value
 */
function getEnvVar(key: string): string | undefined {
  // In Vite, environment variables are available on import.meta.env
  // @ts-ignore - import.meta.env is available in Vite
  return import.meta.env?.[key];
}

/**
 * Parse and validate configuration from environment variables
 * Throws an error if configuration is invalid
 */
function loadConfig(): Config {
  try {
    // Get raw values from environment
    const rawConfig = {
      api: {
        agentV2BaseUrl:
          getEnvVar('VITE_AGENT_V2_BASE_URL') ||
          getEnvVar('VITE_COMPANION_AGENT_BASE_URL') ||
          'http://127.0.0.1:8792',
        agentV2Endpoint: getEnvVar('VITE_AGENT_V2_ENDPOINT') || '/api/agent-v2',
        fullAgentV2Url: '',
      },
      features: {
        enableDebugLogging: getEnvVar('VITE_ENABLE_DEBUG_LOGGING') === 'true',
        maxChatSteps: Number.parseInt(getEnvVar('VITE_MAX_CHAT_STEPS') || '5', 10),
      },
    };

    rawConfig.api.fullAgentV2Url = `${rawConfig.api.agentV2BaseUrl}${rawConfig.api.agentV2Endpoint}`;

    // Validate configuration
    const validatedConfig = ConfigSchema.parse(rawConfig);

    // Log configuration in development mode if debug logging is enabled
    if (import.meta.env?.DEV && validatedConfig.features.enableDebugLogging) {
      console.log('[Config] Loaded configuration:', {
        api: {
          agentV2BaseUrl: validatedConfig.api.agentV2BaseUrl,
          agentV2Endpoint: validatedConfig.api.agentV2Endpoint,
          fullAgentV2Url: validatedConfig.api.fullAgentV2Url,
        },
        features: validatedConfig.features,
      });
    }

    return validatedConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');

      throw new Error(
        `Invalid extension configuration:\n${errorMessages}\n\n` +
          'Please check your environment variables in .env file.'
      );
    }

    throw new Error(
      `Failed to load extension configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Extension configuration singleton
 * Validates and loads configuration on first access
 */
export const config: Config = loadConfig();

/**
 * Re-export the Config type for use in other files
 */
export type { Config as ExtensionConfig };
