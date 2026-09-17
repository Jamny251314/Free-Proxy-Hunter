/**
 * API 地址解析
 * ------------------------------------------------------------
 * 默认情况（前端与后端同源，也就是 `npm start` 的单端口模式）下
 * `VITE_API_BASE_URL` 为空，apiUrl() 原样返回 '/api/...'，
 * 与改造前**完全一致**，现有部署不受影响。
 *
 * 需要把前端单独托管时（静态产物放 Cloudflare Pages / 对象存储，后端留在自己服务器）
 * 在**构建时**注入后端对外地址：
 *
 *   VITE_API_BASE_URL=https://hunter-api.example.com npm run build
 *
 * 三个容易踩的点：
 *   1. VITE_ 前缀变量是**构建期**注入，不是运行期 —— 改了必须重新 build，
 *      只改服务器环境变量不会生效。
 *   2. 后端要同时设置 CORS_ORIGINS 允许前端来源，否则浏览器会拦掉响应
 *      （SSE 走 EventSource，同样受跨域限制）。
 *   3. 若不想跨域，更省事的做法是让静态托管平台把 /api 反向代理到后端
 *      （Cloudflare Pages 加一个 _redirects 规则即可，见 deploy/README）。
 *      那样就完全不需要这个变量，也不会有跨域问题。
 */

const RAW_BASE = String(import.meta.env?.VITE_API_BASE_URL ?? '').trim();

/** 归一化后的后端基地址；空字符串表示与前端同源 */
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

/** 把一个 /api/... 路径拼成可请求的地址 */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${p}`;
}
