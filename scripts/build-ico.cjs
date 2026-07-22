// 把 proma PNG 转成多尺寸 ico（供 rcedit 替换 exe 图标）
// 用法: node build-ico.cjs <src.png> <out.ico>
// 多尺寸含 16x16（Windows 状态栏/小任务栏）+ 256x256（资源管理器大图标）
// 依赖（在 assets/node_modules）: jimp@0.22.10 + png-to-ico
// ⚠️ jimp 必须 pin 0.22.10（latest 1.6.1 破坏 jimp.read API）
const fs = require('fs')
const _path = require('path')
module.paths.push(_path.join(__dirname, '..', 'assets', 'node_modules'))
const jimp = require('jimp')
const pngToIco = require('png-to-ico').default

const src = process.argv[2]
const out = process.argv[3]
const sizes = [256, 128, 96, 64, 48, 32, 16]    // 7 层，含 16x16 状态栏小图标
;(async () => {
  if (!src || !out) { console.error('用法: node build-ico.cjs <src.png> <out.ico>'); process.exit(1) }
  const img = await jimp.read(src)
  const pngs = []
  for (const s of sizes) {
    const buf = await img.clone().resize(s, s).getBufferAsync(jimp.MIME_PNG)
    pngs.push(buf)
  }
  const ico = await pngToIco(pngs)
  fs.writeFileSync(out, ico)
  console.log('OK', out, ico.length, 'bytes, sizes:', sizes.join(','))
})().catch(e => { console.error('FAIL', e && e.message || e); process.exit(1) })
