# Windows Lite 更新源约定

- 决策日期：2026-05-28
- 背景：当前项目需要为 Windows Lite 安装目录提供远程更新源配置，配置文件名固定为 `.webmcp-update-source.json`。
- 决策：后续凡是讨论、生成、校验或写入 Windows Lite 更新源配置时，优先使用如下 JSON 结构：

```json
{
  "windowsLiteZipUrl": "https://你的地址/accr-ui-windows-lite-x64.zip",
  "projectUrl": "https://你的发布页/"
}
```

- 约束：
  - Windows 平台优先读取 `windowsLiteZipUrl`。
  - 发布页使用 `projectUrl`。
  - 如无用户明确指定，不再优先使用通用 `packageUrl` 字段。
- 说明：用户指定的目标路径为 `D:\Users\zhongyy40\accrui\.webmcp-update-source.json`，但当前会话运行环境无法直接访问真实 Windows `D:` 盘，因此本次先将规则登记为项目记忆，并在项目内补充文档说明。