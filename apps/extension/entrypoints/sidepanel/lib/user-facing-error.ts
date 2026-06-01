const EXACT_MESSAGE_MAP: Array<
  [pattern: RegExp, replacement: string | ((match: RegExpMatchArray) => string)]
> = [
  [
    /Could not establish connection\..*Receiving end does not exist\.?/i,
    '无法连接到目标页面，请刷新页面或重新打开侧边栏后重试。',
  ],
  [/Receiving end does not exist\.?/i, '无法连接到目标页面，请刷新页面或重新打开侧边栏后重试。'],
  [/Could not establish connection\.?/i, '无法建立连接，请稍后重试。'],
  [/No SW/i, '扩展后台服务暂不可用，请稍后重试。'],
  [/service worker unavailable/i, '扩展后台服务暂不可用，请稍后重试。'],
  [/message port closed/i, '与扩展页面的通信已关闭，请重试。'],
  [/Unable to connect to the MCP hub/i, '无法连接到 MCP Hub，请稍后重试。'],
  [/Request timed out/i, '请求超时，请稍后重试。'],
  [/deep-read timeout after \d+ms/i, '页面读取超时，请稍后重试。'],
  [/timeout/i, '请求超时，请稍后重试。'],
  [/Workspace directory does not exist/i, '当前路径不存在，请重新选择本地文件夹。'],
  [/Workspace path must be a directory/i, '当前路径不是文件夹，请重新选择本地文件夹。'],
  [/Folder already exists/i, '文件夹已存在，请换一个名称。'],
  [/Folder name is invalid/i, '文件夹名称不合法，请重新输入。'],
  [/Folder name is required/i, '请输入文件夹名称。'],
  [
    /System folder picker is not supported on this platform/i,
    '当前平台暂不支持系统文件夹选择器，请改用手动浏览。',
  ],
  [
    /userscripts api is not available/i,
    '当前浏览器未开放用户脚本能力，请在扩展详情页开启相关权限后重试。',
  ],
  [/Native host connection not established/i, '本地宿主连接尚未建立，请稍后重试。'],
  [/Agent V2 response did not include an SSE body/i, '智能体响应异常，未返回流式数据。'],
  [/Agent run failed/i, '智能体运行失败，请稍后重试。'],
  [/Binary file service is not configured/i, '二进制文件服务未配置。'],
  [/File entry service is not configured/i, '文件条目服务未配置。'],
  [/Workspace browser service is not configured/i, '工作区浏览服务未配置。'],
  [/Workspace service is not configured/i, '工作区服务未配置。'],
  [/Agent interaction service is not configured/i, '智能体交互服务未配置。'],
  [/Agent run service is not configured/i, '智能体运行服务未配置。'],
  [/Session metadata service is not configured/i, '会话元数据服务未配置。'],
];

const FAILED_ACTION_MAP: Record<string, string> = {
  'Failed to load Agent V2 capabilities': '加载智能体能力信息失败',
  'Failed to load system update info': '加载系统更新信息失败',
  'Failed to start system update': '启动系统更新失败',
  'Failed to load Agent V2 sessions': '加载会话列表失败',
  'Failed to load Agent V2 session runs': '加载会话运行记录失败',
  'Failed to load Agent V2 session run state': '加载会话运行状态失败',
  'Failed to add workspace': '添加工作区失败',
  'Failed to rename workspace': '重命名工作区失败',
  'Failed to delete workspace': '删除工作区失败',
  'Failed to open workspace': '打开工作区失败',
  'Failed to pick workspace folder': '选择工作区文件夹失败',
  'Failed to browse workspace folders': '加载本地文件夹失败',
  'Failed to create workspace folder': '新建文件夹失败',
  'Failed to rename session': '重命名会话失败',
  'Failed to delete session': '删除会话失败',
  'Failed to archive session': '归档会话失败',
  'Failed to mark session interrupted': '标记会话中断失败',
  'Failed to load Agent V2 session history': '加载会话历史失败',
  'Failed to resume Agent V2 run stream': '恢复进行中的会话失败，请重启本地服务或稍后重试',
  'Failed to abort Agent V2 run': '停止智能体运行失败',
  'Failed to resolve Agent V2 interaction': '处理交互请求失败',
  'Failed to load files': '加载文件列表失败',
  'Failed to create file entry': '创建文件失败',
  'Failed to rename file entry': '重命名文件失败',
  'Failed to delete file entry': '删除文件失败',
  'Failed to open file entry': '打开文件失败',
  'Failed to read file': '读取文件失败',
  'Failed to write file': '写入文件失败',
  'Failed to write binary file': '写入二进制文件失败',
  'Failed to load commands': '加载命令列表失败',
  'Failed to execute command': '执行命令失败',
  'Failed to analyze DOM': '分析页面 DOM 失败',
  'Failed to load capabilities': '加载能力列表失败',
  'Failed to check skill health': '检查技能状态失败',
  'Failed to read capability': '读取能力详情失败',
  'Failed to read capability file': '读取能力文件失败',
  'Failed to create capability': '创建能力失败',
  'Failed to import skill directory': '导入技能目录失败',
  'Failed to import skill bundle': '导入技能包失败',
  'Failed to update capability': '更新能力失败',
  'Failed to update capability file': '更新能力文件失败',
  'Failed to update capability enabled state': '更新能力启用状态失败',
  'Failed to delete capability': '删除能力失败',
  'Failed to load plugins': '加载插件列表失败',
  'Failed to install plugin': '安装插件失败',
  'Failed to import plugin': '导入插件失败',
  'Failed to update plugin': '更新插件失败',
  'Failed to remove plugin': '删除插件失败',
  'Failed to load hooks overview': '加载钩子概览失败',
  'Failed to load runtime capabilities': '加载运行时能力失败',
  'Failed to load model config': '加载模型配置失败',
  'Failed to save user Claude settings': '保存用户级 Claude settings 失败',
  'Failed to update model config': '更新模型配置失败',
  'Failed to test model config': '测试模型配置失败',
  'Failed to load official model catalog': '加载官方模型列表失败',
  'Failed to load official quota': '加载官方额度信息失败',
  'Failed to update runtime capabilities': '更新运行时能力失败',
  'Failed to load MCP registry': '加载 MCP 注册表失败',
  'Failed to read MCP config': '读取 MCP 配置失败',
  'Failed to save MCP config': '保存 MCP 配置失败',
  'Failed to save MCP server': '保存 MCP 服务失败',
  'Failed to update MCP server': '更新 MCP 服务失败',
  'Failed to delete MCP server': '删除 MCP 服务失败',
  'Failed to load MCP tools': '加载 MCP 工具失败',
  'Failed to update MCP tool permission': '更新 MCP 工具权限失败',
  'Failed to upload session file': '上传会话文件失败',
  'Failed to delete session file': '删除会话文件失败',
};

function formatStatusSuffix(statusCode: string | undefined) {
  return statusCode ? `（状态码 ${statusCode}）。` : '。';
}

export function localizeUserFacingMessage(message: string, fallback = '操作失败，请稍后重试。') {
  const trimmed = message.trim();
  if (!trimmed) {
    return fallback;
  }

  for (const [pattern, replacement] of EXACT_MESSAGE_MAP) {
    const match = trimmed.match(pattern);
    if (match) {
      return typeof replacement === 'function' ? replacement(match) : replacement;
    }
  }

  for (const [englishPrefix, chinesePrefix] of Object.entries(FAILED_ACTION_MAP)) {
    const escaped = englishPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = trimmed.match(new RegExp(`^${escaped}(?::\\s*(\\d+))?$`, 'i'));
    if (match) {
      return `${chinesePrefix}${formatStatusSuffix(match[1])}`;
    }
  }

  const requestFailedMatch = trimmed.match(/^Agent V2 request failed with\s+(\d+)$/i);
  if (requestFailedMatch) {
    return `智能体请求失败（状态码 ${requestFailedMatch[1]}）。`;
  }

  return trimmed;
}

export function localizeUserFacingError(error: unknown, fallback = '操作失败，请稍后重试。') {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : error == null
          ? ''
          : String(error);
  return localizeUserFacingMessage(message, fallback);
}
