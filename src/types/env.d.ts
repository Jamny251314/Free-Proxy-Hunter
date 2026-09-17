/**
 * 前端构建期环境变量的类型声明。
 *
 * 为什么不直接 `/// <reference types="vite/client" />`：
 * 本项目 tsconfig 固定了 `types: ["react","react-dom"]`（见 tsconfig.json 里的说明），
 * 而 vite/client 会带入一批与 DOM/Node 有交集的声明，容易和历史遗留的
 * `src/types/vendor-shims.d.ts` 打架。这里只声明真正用到的那一个变量，
 * 最小侵入。
 *
 * 新增 VITE_ 变量时在这里补一行，否则 tsc 会报「属性不存在」。
 */
interface ImportMetaEnv {
  /** 后端基地址；留空（默认）表示与前端同源 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
