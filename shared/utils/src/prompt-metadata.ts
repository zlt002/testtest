const USER_ORIGINAL_REQUEST_TAG_PATTERN =
  /<(?:用户原始请求|user_original_request)>\s*([\s\S]*?)\s*<\/(?:用户原始请求|user_original_request)>/i;

const EXPLICIT_SKILL_NAME_PATTERN = /<webmcp_explicit_skill\b[^>]*\bname=(["'])(.*?)\1[^>]*>/i;

const GENERATED_PROMPT_METADATA_BLOCK_PATTERN =
  /<((?:attachments)|(?:project_workspace)|(?:interaction_policy)|(?:webmcp_browser_tool_instruction)|(?:webmcp_explicit_skill)|(?:[a-z0-9_-]*(?:instruction|context|workspace)[a-z0-9_-]*))\b[^>]*>[\s\S]*?<\/\1>/gi;

const GENERATED_PROMPT_METADATA_LINE_PATTERN =
  /^\s*:?\s*<?\/?(?:attachments|project_workspace|interaction_policy|webmcp_browser_tool_instruction|webmcp_explicit_skill|[a-z0-9_-]*(?:instruction|context|workspace)[a-z0-9_-]*)\b/i;

export function extractOriginalUserRequestText(text: string) {
  const match = text.match(USER_ORIGINAL_REQUEST_TAG_PATTERN);
  return match?.[1] ?? text;
}

export function extractExplicitSkillName(text: string) {
  const match = text.match(EXPLICIT_SKILL_NAME_PATTERN);
  const skillName = match?.[2]?.trim();
  return skillName || undefined;
}

export function stripGeneratedPromptMetadata(text: string) {
  return extractOriginalUserRequestText(text)
    .replace(GENERATED_PROMPT_METADATA_BLOCK_PATTERN, '')
    .split(/\r?\n/)
    .filter((line) => !GENERATED_PROMPT_METADATA_LINE_PATTERN.test(line))
    .join('\n');
}

export function summarizePromptForDisplay(text: string) {
  const stripped = stripGeneratedPromptMetadata(text).trim();
  return stripped || extractExplicitSkillName(text) || '';
}
