# WebEdit Office

适用场景：当前会话位于美的 WebEdit 办公页面，需要判断应该走文档能力、表格能力，或先做诊断。

工作原则：

1. 先调用 `mcp__browser_extension__list_website_tools`，确认当前页面真实暴露了哪些 `webedit_*` tools。
2. 看到文档类工具时，优先转入 `webedit-assistant:webedit-word` 的工作流。
3. 看到表格类工具时，优先转入 `webedit-assistant:webedit-sheet` 的工作流。
4. 用户意图不明确时，先读上下文，不要直接写。
5. 工具缺失、选区异常、返回空结果、运行时不稳定时，立即进入诊断模式，明确告诉用户缺的是哪一层能力。

诊断模式要求：

- 先说明缺失的工具或上下文。
- 给出下一步最小可执行动作，例如“先读取当前文档正文”或“先读取当前表格选区”。
- 禁止在工具未确认可用时假装完成写入。
