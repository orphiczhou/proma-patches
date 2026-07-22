// 用 rcedit 把 exe 图标替换为指定 ico。用法: node set-exe-icon.cjs <exe> <ico>
// rcedit v5 用 exports 不用 main，故注入 module.paths 后用包名 require（走 exports 解析）
// ⚠️ rcedit 不能直接改原 exe（进程锁 "Unable to commit changes"），必须先 cp 副本再注入
const _path = require('path')
module.paths.push(_path.join(__dirname, '..', 'assets', 'node_modules'))
const rcedit = require('rcedit').rcedit        // v5 关键：解构 .rcedit（不能直接 require 当函数）
const exe = process.argv[2]
const ico = process.argv[3]
if (!exe || !ico) { console.error('用法: node set-exe-icon.cjs <exe> <ico>'); process.exit(1) }
rcedit(exe, { icon: ico })
  .then(() => console.log('OK icon set on', exe))
  .catch((e) => { console.error('FAIL', exe, e && e.message || e); process.exit(1) })
