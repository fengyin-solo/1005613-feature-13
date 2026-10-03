// 抢修领域规则冒烟测试：打包 smoke-repair.ts 后在 node 里跑，localStorage 用内存模拟。
// 用法：npm run smoke
import { buildSync } from 'esbuild'

const root = new URL('..', import.meta.url).pathname

buildSync({
  entryPoints: [`${root}scripts/smoke-repair.ts`],
  bundle: true,
  format: 'esm',
  alias: { '@': `${root}src` },
  outfile: `${root}scripts/.smoke.bundle.mjs`,
  logLevel: 'warning',
})

const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  },
}

await import(`${root}scripts/.smoke.bundle.mjs`)
