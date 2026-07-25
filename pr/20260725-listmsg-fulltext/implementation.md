# list_messages full_text 字段修复

**日期**: 2026-07-25
**文件**: `D:/Codes/tree-harness/proma-dev-patches.cjs`

## 改动内容

**位置**: L1044–1047 → L1044–1048（`realTexts` 处理段）

**改动前**:
```js
if (realTexts.length > 0) {
  entry.text = realTexts.join("\n").slice(0, 500);
  entry.text_full_length = realTexts.join("\n").length;
}
```

**改动后**:
```js
if (realTexts.length > 0) {
  const _fullText = realTexts.join("\n");
  entry.text = _fullText.slice(0, 500);          // 向后兼容（截断）
  entry.text_full_length = _fullText.length;       // 全文长度（原有）
  entry.full_text = _fullText;                     // 新增：全文（不截断）
}
```

## 变更说明

| 字段 | 状态 | 说明 |
|------|------|------|
| `text` | 保留（截断） | `slice(0, 500)`，向后兼容 |
| `text_full_length` | 保留 | 全文长度（原有字段） |
| `full_text` | **新增** | 全文，不截断 |

## node --check 结果

```
✅ 通过（无输出）
```

## 向后兼容

- `text` 仍为 500 字符截断，现有调用方不受影响
- `full_text` 为新增字段，调用方按需读取
- `text_full_length` 保持不变

## HTTP bridge 复用确认

`createExternalHttpBridge`（L1791）通过 `handlers = createToolHandlers(null)`（L1794）
复用本地 handler，`remote_list_messages` 走同一 handler，因此自动受益于本次修改，
**无需单独修改**。
