/**
 * 修复 strip-dev-console 误将 foo?.(bar) 打成 foo?.<>(bar) 的问题
 */
import fs from 'fs'
import path from 'path'

function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (f === 'node_modules' || f === 'dist' || f === 'out') continue
      walk(p)
    } else if (/\.(ts|tsx)$/.test(f)) {
      let s = fs.readFileSync(p, 'utf8')
      const s2 = s.replace(/\?\.\<\>\(\)/g, '?.()').replace(/\?\.\<\>\(/g, '?.(')
      if (s2 !== s) {
        fs.writeFileSync(p, s2, 'utf8')
        console.log('fixed:', path.relative(process.cwd(), p))
      }
    }
  }
}

walk(path.join(process.cwd(), 'src', 'renderer'))
walk(path.join(process.cwd(), 'vendor', 'war3-model'))
