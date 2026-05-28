# Windows Lite 更新源项目记忆

日期：2026-05-28

后续凡是涉及 Windows Lite 更新源配置，默认优先使用下面这份 JSON 结构：

```json
{
  "windowsLiteZipUrl": "https://你的地址/accr-ui-windows-lite-x64.zip",
  "projectUrl": "https://你的发布页/"
}
```

约定如下：

- 配置文件名使用 `.webmcp-update-source.json`
- Windows 安装包地址优先使用 `windowsLiteZipUrl`
- 发布页地址使用 `projectUrl`
- 除非用户明确要求，否则相关讨论、示例和写入内容都按这份结构优先处理

说明：

- 用户指定的目标路径是 `D:\Users\zhongyy40\accrui\.webmcp-update-source.json`
- 当前会话运行在 macOS 环境，无法直接访问真实 Windows `D:` 盘，因此这里先将约定固化为项目内文档和项目 ADR 记忆

---

# Windows Lite 打包记忆

日期：2026-05-28

后续凡是涉及 `Windows Lite` 打包，默认遵循下面这套原则和方法：

## 1. 打包入口

- 统一使用根脚本：`pnpm release:windows-lite`
- 脚本来源：`package.json` -> `scripts/build-windows-lite.mjs`
- 不再手工拼装 `release/` 目录内容，默认交给脚本完整生成

## 2. 环境前提

- Node 版本要求：`>=22.12`
- pnpm 版本要求：`10.x`
- 仓库依赖需要已安装
- 打包脚本会自动重新执行 `build:extension`，不需要额外手动预构建

## 3. 产物位置

- 目录产物：`release/accr-ui-windows-lite-x64/`
- 最终压缩包：`release/accr-ui-windows-lite-x64.zip`
- 版本状态文件：`release/windows-lite-beta-version.json`
- 更新日志源文件：`docs/windows-lite-release-notes.md`

## 4. 版本号规则

- 当前 beta 版本由 `scripts/build-windows-lite.mjs` 里的：
  - `WINDOWS_LITE_BETA_MAJOR`
  - `WINDOWS_LITE_BETA_MINOR`
  - `release/windows-lite-beta-version.json` 中的 `lastBuildNumber`
  共同决定
- 当前规则为：`beta.1.1.x`
- 每执行一次 `pnpm release:windows-lite`，`lastBuildNumber` 都会自动加 `1`
- 因此“再打一包”不应假设版本号连续只加一次；必须以实际打包输出和 `release/windows-lite-beta-version.json` 为准

## 5. 更新日志整理原则

- `docs/windows-lite-release-notes.md` 只写“这一次待发布版本真正新增/修复的内容”
- 如果用户明确说“只保留这次更新”，要删除之前已经发过的旧条目，不做累计流水账
- 更新日志优先依据当前 `git diff --stat` 和关键 diff 内容整理
- 文案应尽量写成“用户可感知变化”，避免直接堆内部实现细节
- 典型做法：
  - 先看 `git diff --stat`
  - 再读关键 diff
  - 提炼成 5~10 条用户可读更新
  - 再补少量升级提示

## 6. 验收原则

- 打包完成后，至少确认下面几项：
  - `release/accr-ui-windows-lite-x64.zip` 文件存在
  - `release/windows-lite-beta-version.json` 已更新到新版本
  - 包内包含 `install.vbs`、`install.ps1`、`payload.zip`
  - 包内 `runtime/release-notes.html` 与当前 `docs/windows-lite-release-notes.md` 一致

## 7. 已知现象

- 构建过程中长期存在两类非阻断警告：
  - `WXT route piece` 警告
  - 前端 chunk 过大警告
- 只要脚本最终成功生成 zip，这两类警告当前默认视为“不阻断出包”

## 8. 协作约定

- 用户经常会连续要求“再打一包”，这意味着要明确提醒：
  - 版本号会继续自动递增
  - 最终以脚本输出和状态文件为准
- 如果用户要求“日志只保留这次内容”，下一次打包前应先清理旧条目，再重新出包
