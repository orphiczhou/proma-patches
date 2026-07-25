# list_messages 截断修复 — 实施与验证结果（收敛）

> 日期：2026-07-25 | 修复 tests/003 §5 发现的问题 1
> PR 目录：pr/20260725-listmsg-fulltext/

## 1. 问题

`list_messages` 返回的 `message.text` / `result.result_text` 被 `slice(0, 500)` 截断。长消息（如 fork identityPrompt 890+ 字符）无法直接从消息历史验证全文——tests/003 观察员靠"让会话复述"绕过。

## 2. 改动（两类消息三字段对称）

`proma-dev-patches.cjs` L1005 `list_messages` handler：

### message 侧（L1044-1049）
```js
const _fullText = realTexts.join("\n");
entry.text = _fullText.slice(0, 500);          // 截断，向后兼容
entry.text_full_length = _fullText.length;       // 全文长度（原有）
entry.full_text = _fullText;                     // 新增：全文
```

### result 侧（L1038-1042，观察员反馈后补齐）
```js
const _fullResult = String(m.result);
entry.result_text = _fullResult.slice(0, 500);          // 截断，向后兼容
entry.result_text_full_length = _fullResult.length;      // 新增：全文长度（对称 text_full_length）
entry.result_full_text = _fullResult;                    // 新增：全文
```

**三字段对称**：截断（向后兼容）+ 全文长度 + 全文。HTTP bridge 复用本地 handler（`createExternalHttpBridge` L1794 `handlers = createToolHandlers(null)`），`remote_list_messages` 自动受益，不需单独改。

## 3. 执行流程（指挥官 + 观察员 + 父会话，迭代收敛）

| 步 | 角色 | 动作 | 结果 |
|----|------|------|------|
| 1 | 实施子会话 7d4487dc | 修 full_text（L1044-1049） | implementation.md |
| 2 | 父会话 | cp + restart dev | 部署 dev |
| 3 | 指挥官 4afbd84f（dev） | 测 full_text（list 46aa7572 index 15） | PASS（1344 字符全文） |
| 4 | 观察员 39a52833（dev） | 观察指挥官 + 独立抽查 | PASS（数字对上，未编造）+ 发现 result_text 截断一致性 |
| 5 | 父会话 | 补 result_full_text（L1038） + restart dev | — |
| 6 | 观察员 39a52833（dev） | 复查 result_full_text | PASS（index 12/16）+ 发现缺 result_text_full_length 对称 |
| 7 | 父会话 | 补 result_text_full_length + restart dev | 对称性收敛 |
| 8 | 父会话 | 自验 remote_list_messages | PASS（三字段对称，见 §4） |

## 4. 验证结果（dev 实例 46aa7572，父会话 remote_list_messages 实测）

| index | 类型 | 截断字段 | 长度字段 | 全文字段 | 全文长度 |
|-------|------|---------|---------|---------|---------|
| 15 | assistant | text ✅ | text_full_length=1344 ✅ | full_text ✅ | 1344 |
| 12 | result | result_text ✅ | result_text_full_length=1989 ✅ | result_full_text ✅ | 1989 |
| 16 | result | result_text ✅ | result_text_full_length=1344 ✅ | result_full_text ✅ | 1344 |

- 全文未在 500 截断（末尾自然结尾，如 index 15 full_text 结尾"等待父会话进一步指令"vs text 生硬切断在"leaf_id"）
- message 侧 + result 侧三字段对称 ✅
- **附带确认**：index 15 full_text 含 P1+ identityPrompt 全文（`协作子会话限制（delegationDepth=1）`+ `delegate_agent` 出现 2 次 + 3 替代方案）—— 再次确认 P1+ 真实注入

## 5. 收敛

list_messages 截断问题**完整修复**（message + result 两类，三字段对称）。指挥官（dev 实例测试）+ 观察员（dev 实例独立抽查）+ 父会话（自验）三层验证一致。

## 6. 部署状态

- **dev**：已部署（cp + restart dev）✅ 生效
- **pro**：未部署（保持 tests/003 时状态）。如需 pro 同步：`cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/ && restart-pro.ps1`

## 7. 交付物

- `proma-dev-patches.cjs`（L1038-1042 result 侧 + L1044-1049 message 侧）
- `pr/20260725-listmsg-fulltext/{implementation.md（full_text 实施）, results.md（完整记录）}`
- 指挥官报告（在 dev 实例会话 4afbd84f 的 messages）+ 观察员报告（39a52833 messages）
