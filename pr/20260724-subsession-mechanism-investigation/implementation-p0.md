# P0 实施报告：Pi 运行时 collaboration 伪可用陷阱修复

> 实施日期：2026-07-25 | 实施子会话：09c127df（pi, delegationDepth=?）
> 对应 design.md §4 P0

## 1. 改了什麼

在 `apply-patches.sh` 新增**补丁 Q**，对 Pi 运行时的 collaboration 工具注入条件补上 `delegationDepth` 检查，与 Claude 路径对齐。

### 补丁 Q 位置

- 插入位置：补丁 P（pi customTools 注入）之后、补丁 B（API 桥接）之前
- 文件：`D:/Codes/tree-harness/apply-patches.sh`

### 完整 sed 命令

```bash
sed -i 's|triggeredBy !== "delegation";|triggeredBy !== "delegation" \&\& (ctx.sessionMeta?.delegationDepth ?? 0) === 0;|' "$TMPDIR/main-patched.cjs"
```

### 验证 grep

```bash
grep -q '(ctx.sessionMeta?.delegationDepth ?? 0) === 0' "$TMPDIR/main-patched.cjs"
```

### 效果

| | 改前 | 改后 |
|---|---|---|
| **Claude 路径 (L469229)** | `&& (ctx.sessionMeta?.delegationDepth ?? 0) === 0;` | 不动 |
| **Pi 路径 (L469701)** | `triggeredBy !== "delegation";`（缺 depth 检查） | `triggeredBy !== "delegation" && (ctx.sessionMeta?.delegationDepth ?? 0) === 0;` |

depth>0 的 Pi 子会话不再看到 collaboration 工具，与 Claude 行为一致。

## 2. 锚点唯一性验证

```bash
$ grep -c 'triggeredBy !== "delegation";' /d/Proma-dev/resources/app/dist/main.cjs
1
```

✅ 确认唯一：只有 Pi 那处（L469701）以分号结尾，Claude 那处（L469229）后接空格+`&&`。

### 两处理论位置对照

```bash
$ grep -n 'triggeredBy !== "delegation"' /d/Proma-dev/resources/app/dist/main.cjs
469229:  ... && ctx.triggeredBy !== "delegation" && (ctx.sessionMeta?.delegationDepth ?? 0) === 0;
469701:  ... && ctx.triggeredBy !== "delegation";
```

## 3. sed 测试片段验证

**输入：**
```
  const collaborationAvailable = isBuiltinMcpUserEnabled("collaboration") && !!ctx.workspaceId && ctx.triggeredBy !== "delegation";
```

**sed 命令：**
```bash
echo '...' | sed 's|triggeredBy !== "delegation";|triggeredBy !== "delegation" \&\& (ctx.sessionMeta?.delegationDepth ?? 0) === 0;|'
```

**输出：**
```
  const collaborationAvailable = isBuiltinMcpUserEnabled("collaboration") && !!ctx.workspaceId && ctx.triggeredBy !== "delegation" && (ctx.sessionMeta?.delegationDepth ?? 0) === 0;
```

✅ `&&` 完整保留，未被转义吃掉；`=== 0;` 正确追加。

## 4. main.cjs 副本实测

```bash
cp /d/Proma-dev/resources/app/dist/main.cjs /tmp/main-test.cjs
sed -i 's|triggeredBy !== "delegation";|triggeredBy !== "delegation" \&\& (ctx.sessionMeta?.delegationDepth ?? 0) === 0;|' /tmp/main-test.cjs
```

**改后两处结果：**
```
469229:  ... && ctx.triggeredBy !== "delegation" && (ctx.sessionMeta?.delegationDepth ?? 0) === 0;   ← Claude 不动
469701:  ... && ctx.triggeredBy !== "delegation" && (ctx.sessionMeta?.delegationDepth ?? 0) === 0;   ← Pi 已对齐
```

✅ Pi 路径正确补上 depth 检查，Claude 路径未受影响。

**改后锚点消失验证：**
```bash
$ grep -c 'triggeredBy !== "delegation";' /tmp/main-test.cjs
0
```
分号结尾的旧锚点已消除，说明没有遗漏。

## 5. 修改清单

| 文件 | 改动 |
|------|------|
| `apply-patches.sh` 顶部注释 | 补丁清单加 `+ 补丁Q` |
| `apply-patches.sh` 第 7 行 | 新增补丁 Q 单行说明 |
| `apply-patches.sh` 第 86-93 行 | 新增补丁 Q 完整代码块（sed + grep 验证） |
| `apply-patches.sh` 第 157 行 | echo 状态行加 `+ 补丁Q` |
| `apply-patches.sh` 第 287 行 | 完成提示：`8 补丁` → `9 补丁`，加 `补丁Q` |

## 6. 风险 / 注意点

- **锚点可靠性**：依赖 `triggeredBy !== "delegation";`（带分号）在 minified main.cjs 中只有 Pi 那处出现。如果上游版本更新改变了代码格式（如 Pi 和 Claude 共享同一处判断），锚点可能失配。此时 grep -c 会 ≠ 1，补丁 Q 的 grep 验证会报错退出（`set -e` 保护）。
- **不影响部署**：本次只改 `apply-patches.sh`，不部署、不 commit。父会话负责后续部署验证。
- **与补丁 P 的顺序**：补丁 Q 在补丁 P 之后执行，顺序合理——P 注入 Pi customTools 钩子，Q 修正 collaboration 注入条件，两者独立无冲突。

## 7. 结论

✅ 补丁 Q 已就绪：
- 锚点唯一性确认（grep -c = 1）
- sed 测试片段通过
- main.cjs 副本实测通过（Pi 对齐、Claude 不动）
- apply-patches.sh 三处注释/状态/完成提示已同步更新
