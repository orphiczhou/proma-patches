# PR: tree_init 返回 naming 代码示例（P0-2）

> 日期：2026-07-24 | 改动文件：tree-engine.cjs | 优先级：P0

## 1. 根因分析

macp 实战（tests/002）暴露 GLM-5.2 有 **24.3% 工具调用失败率**，集中三类：

| 错误 | 正确 | 次数 |
|------|------|------|
| `path="macp/A"` | `path="A"` (不含 prefix) | 12 |
| milestone id 字段名错（`milestone_id`/`name`） | 字段名 `id` | 6 |
| `expect_outputs: ["/abs/path/file"]` | `expect_outputs: ["relative/path"]` | 6 |

**根因**：`buildInitTips()` 返回的 `next_steps` 全是 help-topic 文本指针（"调 mcp__tree__tree_help('naming_convention')"），没有可直接复制的代码示例。Agent 需要额外 round-trip 调 help 才知道正确格式，增加试错成本。

## 2. 改动点

### 2.1 `buildInitTips()` 增强（tree-engine.cjs L859-871）

在返回对象中新增 `naming_examples` 字段，包含：
- `leaf_add_example`: 正确的 leaf_add JSON（path 相对、leaf_id 符合正则）
- `milestone_add_example`: 正确的 milestone_add JSON（id 字段名、expect_outputs 相对路径）
- `common_pitfalls`: 三类高频错误的 ❌→✅ 对照

**不改变现有字段**（next_steps / skill_reference / pro_tip 保持不变），只追加。

**设计原则**：渐进披露——示例放在 init 返回里，Agent 第一次建树就能看到正确格式，不必调 help。

## 3. 测试计划

1. `node --check tree-engine.cjs` 语法校验
2. CLI 调用 `node tree-engine.cjs init test-p02 --root-brief '{}'`，验证返回 JSON 包含 `naming_examples`
3. 回归：现有 next_steps / skill_reference / pro_tip 不变
