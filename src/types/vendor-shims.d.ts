/**
 * 第三方包类型收口
 * ------------------------------------------------------------
 * tdesign-icons-react@0.5.x 的 npm 包只发布了 `esm/components/*.d.ts`，
 * 既没有根级 `index.d.ts`，package.json 里也没有 `types` / `exports` 字段，
 * 因此 TypeScript 无法解析该模块的类型。
 *
 * 图标在本项目中仅作装饰用途，不参与任何业务逻辑的类型推导，
 * 这里做一次模块声明收口，避免 9 个文件出现无关的 TS7016 报错。
 */
declare module 'tdesign-icons-react';
