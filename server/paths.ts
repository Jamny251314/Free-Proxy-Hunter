/**
 * 数据目录解析（唯一权威）
 * ------------------------------------------------------------
 * 为什么要有这个文件：
 *   原先 store.ts 与 db.ts 各自用 `path.join(__dirname, '..', 'data')` 算了一遍数据目录，
 *   两处独立演算必然有一天会不一致 —— 而它们写的是同一个物理目录。
 *   更关键的是：容器部署要把数据目录挂成 volume，路径必须能由外部指定。
 *
 * DATA_DIR 语义：
 *   - 未设置 → 项目根目录下的 data/（与历史行为完全一致）
 *   - 已设置 → 按**进程工作目录**解析。容器里建议写绝对路径（如 /app/data），
 *     避免依赖启动时的 cwd。
 *
 * 注意：这里刻意按 __dirname（源码位置）而不是 process.cwd() 兜底 ——
 * 从任意目录执行 `npm start` 都能找到同一份数据。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录（server/ 的上一级） */
export const PROJECT_ROOT = path.join(__dirname, '..');

/** 数据目录：代理池、引擎配置、Clash 产物、会话记录都写在这里 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(PROJECT_ROOT, 'data');

export const PROXY_FILE = path.join(DATA_DIR, 'proxies.json');
export const CONFIG_FILE = path.join(DATA_DIR, 'proxy-config.json');
export const CLASH_FILE = path.join(DATA_DIR, 'clash-proxies.yaml');
export const CHAT_DB_FILE = path.join(DATA_DIR, 'chat.db');
export const CHAT_JSON_FILE = path.join(DATA_DIR, 'chat.json');

/**
 * 确保数据目录存在。
 *
 * 容器里挂载 volume 时，宿主目录可能是 root 所有、而容器内以非 root 运行 ——
 * 这种情况要让错误信息说清楚「哪个目录写不进去」，而不是抛一个裸 EACCES。
 */
export function ensureDataDir(): void {
  if (fs.existsSync(DATA_DIR)) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `无法创建数据目录 ${DATA_DIR}：${reason}\n` +
        `  · 容器部署请确认该路径已挂载 volume 且运行用户有写权限\n` +
        `  · 或改用 DATA_DIR 指向一个可写目录`,
    );
  }
}

ensureDataDir();
