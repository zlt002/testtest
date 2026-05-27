---
name: ewankb-server-query
description: 通过 MCP 远端查询 ewankb 知识库。默认图谱查询，也可指定 kb 或 deep 双路对比模式。查询结果自动穿透到源代码层，验证规格与实现的一致性。
trigger: /ewankb-server-query
---

# /ewankb-server-query

通过 ewan-kb-server MCP 服务远端查询知识库，无需本地安装 ewankb 或拉取知识库代码。

## 用法

```text
/ewankb-server-query <问题>                          # 图谱查询（默认）
/ewankb-server-query graph <kb> <问题>               # 图谱查询（指定 KB）
/ewankb-server-query kb <kb> <问题>                  # 文档检索
/ewankb-server-query deep <kb> <问题>                # 双路对比查询
/ewankb-server-query list                            # 列出所有可用 KB
```

## 执行步骤

### 0. 检查 MCP 配置

在执行任何查询之前，先尝试调用 `list_kbs` MCP 工具确认 ewan-kb-server 已连接。

如果工具不可用（`No such tool available`），输出以下引导信息并停止：

```text
未检测到 ewan-kb-server MCP 服务。请按以下步骤配置：

1. 打开 ~/.claude.json（注意：不是 settings.json，settings.json 不支持 mcpServers）

2. 添加或修改 "mcpServers" 字段：
   "mcpServers": {
     "ewankb-server": {
       "type": "sse",
       "url": "http://<server-host>:22902/sse/sse"
     }
   }
   或使用 Streamable HTTP：
   "mcpServers": {
     "ewankb-server": {
       "type": "streamable-http",
       "url": "http://<server-host>:22902/mcp/mcp"
     }
   }

3. 保存后重启 Claude Code 即可生效

如果没有搭建过 ewan-kb-server 服务，参考：https://github.com/Ewan-Jones/ewan-kb-server
```

如果工具可用，继续执行后续步骤。

### 0.5. 确定目标 KB

用户可以通过以下方式指定 KB：

1. 子命令中显式指定：`/ewankb-server-query graph mall "付款额度"`
2. 对话中说明：如“用 mall 这个库查一下付款额度”

如果用户没有指定 KB，调用 `list_kbs` MCP 工具获取可用 KB 列表，然后：

- 如果只有 1 个 KB，自动使用它
- 如果有多个 KB，展示列表让用户选择

```text
检测到以下可用知识库：

| 库名 | 节点数 | 边数 | 文档数 | 目录 |
|------|--------|------|--------|------|
| ...  | ...    | ...  | ...    | ...  |

请指定要查询的知识库，如：/ewankb-server-query graph <库名> "问题"
```

### 1. 判断查询模式

根据用户输入确定模式：

- `/ewankb-server-query <问题>`：先确定 KB，再走图谱模式
- `/ewankb-server-query graph <kb> <问题>`：图谱模式
- `/ewankb-server-query kb <kb> <问题>`：文档检索模式
- `/ewankb-server-query deep <kb> <问题>`：双路对比模式
- `/ewankb-server-query list`：调用 `list_kbs`，展示所有 KB

### 2A. Graph 模式

调用 `query_graph`：

```text
query_graph(query_text="用户问题", kb="目标kb", traversal="bfs", max_nodes=50)
```

结果为空或节点极少时：

- 告知用户图中未找到匹配节点
- 建议尝试更短关键词
- 建议尝试英文术语
- 建议切换到 `/ewankb-server-query kb <kb> "同一问题"`

结果非空时：

- 基于节点和边关系用自然语言回答
- 引用 `source_file`、`source_location`、`relation` 作为证据
- 不要编造图中没有的关系
- 如果图深度不足，明确说明

回答末尾附建议：`想看原文？试 /ewankb-server-query kb <kb> "同一问题"`

### 2B. KB 模式

调用 `query_kb`：

```text
query_kb(query_text="用户问题", kb="目标kb", max_results=8, domain="")
```

如果返回文档中的“关联代码”为空，自动执行代码穿透。

回答末尾附建议：`想看关联？试 /ewankb-server-query graph <kb> "同一问题"`

### 2C. 双路对比模式

并行启动两个 subagent：

- Subagent A：调用 `query_graph`，提取节点、边、术语、代码线索
- Subagent B：调用 `query_kb`，提取文档结论、术语、代码线索

如果两路存在歧义，继续追问并对比，最多 5 轮。

最终回答格式：

```text
## 回答
[综合回答]

## 信息来源
- 图谱：[关键发现]
- 文档：[关键发现]
- 代码：[关键发现]

## 代码验证（如有差异）
- [规格 vs 实现] {差异描述}
- 证据：{源文件路径}:{行号}

## 差异说明（如有）
```

### 3. 代码穿透

无论哪种查询模式，只要结果中能提取到技术术语，就执行代码穿透，验证规格与实现是否一致。

优先提取这些术语：

- API 路径
- 请求参数名
- 响应字段名
- 表名
- 字段代码
- 业务实体编码
- 类名
- 文件路径片段

调用 `search_source`：

```text
search_source(query_text="技术术语", kb="目标kb", glob="*.java", max_results=50)
```

命中关键文件后，用 `read_source_file` 深入阅读：

```text
read_source_file(kb="目标kb", path="repos/.../KeyFile.java", start_line=1, end_line=0)
```

补充回答时：

- 区分知识库结论和代码实现
- 明确指出一致或差异
- 给出具体文件路径和行号
- 不要把“推测”写成“事实”
