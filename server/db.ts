/**
 * 会话与消息持久化
 * ------------------------------------------------------------
 * 采用「驱动自适应」策略：
 *   1. 优先使用 better-sqlite3（原生模块，性能最好）
 *   2. 若原生模块不可用（未编译成功 / 预编译包下载失败 / 缺少构建工具链），
 *      自动降级为纯 JS 的 JSON 文件存储
 *
 * 两种驱动对外暴露完全相同的方法签名，调用方（server/index.ts）无需感知差异。
 * 这样 `npm install` 不再强依赖本地 C++ 构建环境。
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { CHAT_DB_FILE, CHAT_JSON_FILE } from './paths.js';

// 数据目录同样收敛到 ./paths.ts：与代理池共用同一个目录（默认 <项目根>/data，
// 可用 DATA_DIR 覆盖），容器部署只需要挂一个 volume。
// 该模块被 import 时就已确保目录存在，这里不再重复 mkdir。
const DB_PATH = CHAT_DB_FILE;
const JSON_PATH = CHAT_JSON_FILE;

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

/** 存储驱动：SQLite 与 JSON 两种实现都满足该接口 */
export interface ChatStore {
  readonly driver: 'sqlite' | 'json';
  getAllSessions(): DbSession[];
  getSession(id: string): DbSession | undefined;
  createSession(session: DbSession): DbSession;
  updateSession(
    id: string,
    updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>,
  ): boolean;
  deleteSession(id: string): boolean;
  getMessagesBySession(sessionId: string): DbMessage[];
  createMessage(message: DbMessage): DbMessage;
  updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean;
  deleteMessage(id: string): boolean;
  createMessages(messages: DbMessage[]): void;
  clearAllData(): void;
}

/* ------------------------------------------------------------------ */
/* 驱动 1：SQLite（better-sqlite3）                                    */
/* ------------------------------------------------------------------ */

const require = createRequire(import.meta.url);

function tryLoadSqlite(): ChatStore | null {
  let Database: any;
  try {
    Database = require('better-sqlite3');
  } catch {
    return null;
  }

  try {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        sdk_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        model TEXT,
        created_at TEXT NOT NULL,
        tool_calls TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    `);

    // 迁移：老库补 sdk_session_id 列
    try {
      const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'sdk_session_id')) {
        db.exec('ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT');
        console.log('[DB] 已为 sessions 表补充 sdk_session_id 列');
      }
    } catch {
      /* 列已存在 */
    }

    console.log(`[DB] 使用 SQLite 驱动：${DB_PATH}`);

    return {
      driver: 'sqlite',

      getAllSessions() {
        return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as DbSession[];
      },
      getSession(id) {
        return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as DbSession | undefined;
      },
      createSession(session) {
        db.prepare(
          `INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          session.id,
          session.title,
          session.model,
          session.sdk_session_id ?? null,
          session.created_at,
          session.updated_at,
        );
        return session;
      },
      updateSession(id, updates) {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.title !== undefined) {
          fields.push('title = ?');
          values.push(updates.title);
        }
        if (updates.model !== undefined) {
          fields.push('model = ?');
          values.push(updates.model);
        }
        if (updates.sdk_session_id !== undefined) {
          fields.push('sdk_session_id = ?');
          values.push(updates.sdk_session_id);
        }
        if (fields.length === 0) return false;
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        return (
          db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
            .changes > 0
        );
      },
      deleteSession(id) {
        return db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0;
      },
      getMessagesBySession(sessionId) {
        return db
          .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
          .all(sessionId) as DbMessage[];
      },
      createMessage(message) {
        db.prepare(
          `INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.model,
          message.created_at,
          message.tool_calls,
        );
        db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          message.session_id,
        );
        return message;
      },
      updateMessage(id, updates) {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.content !== undefined) {
          fields.push('content = ?');
          values.push(updates.content);
        }
        if (updates.tool_calls !== undefined) {
          fields.push('tool_calls = ?');
          values.push(updates.tool_calls);
        }
        if (fields.length === 0) return false;
        values.push(id);
        return (
          db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`).run(...values)
            .changes > 0
        );
      },
      deleteMessage(id) {
        return db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes > 0;
      },
      createMessages(messages) {
        const stmt = db.prepare(
          `INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const insertMany = db.transaction((list: DbMessage[]) => {
          for (const m of list) {
            stmt.run(m.id, m.session_id, m.role, m.content, m.model, m.created_at, m.tool_calls);
          }
        });
        insertMany(messages);
      },
      clearAllData() {
        db.exec('DELETE FROM messages');
        db.exec('DELETE FROM sessions');
      },
    };
  } catch (e) {
    console.warn('[DB] 加载 SQLite 失败，改用 JSON 存储：', (e as Error).message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 驱动 2：JSON 文件（零依赖降级方案）                                  */
/* ------------------------------------------------------------------ */

function createJsonStore(): ChatStore {
  interface Shape {
    sessions: DbSession[];
    messages: DbMessage[];
  }

  let cache: Shape = { sessions: [], messages: [] };
  try {
    if (fs.existsSync(JSON_PATH)) {
      const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) as Partial<Shape>;
      cache = { sessions: raw.sessions ?? [], messages: raw.messages ?? [] };
    }
  } catch (e) {
    console.warn('[DB] 读取 chat.json 失败，使用空数据：', (e as Error).message);
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const saveSoon = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const tmp = `${JSON_PATH}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
        fs.renameSync(tmp, JSON_PATH);
      } catch (e) {
        console.error('[DB] 写入 chat.json 失败：', (e as Error).message);
      }
    }, 300);
  };

  console.log(`[DB] 使用 JSON 驱动：${JSON_PATH}`);

  return {
    driver: 'json',

    getAllSessions() {
      return [...cache.sessions].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    getSession(id) {
      return cache.sessions.find((s) => s.id === id);
    },
    createSession(session) {
      cache.sessions.push({ ...session, sdk_session_id: session.sdk_session_id ?? null });
      saveSoon();
      return session;
    },
    updateSession(id, updates) {
      const target = cache.sessions.find((s) => s.id === id);
      if (!target) return false;
      if (updates.title !== undefined) target.title = updates.title;
      if (updates.model !== undefined) target.model = updates.model;
      if (updates.sdk_session_id !== undefined) target.sdk_session_id = updates.sdk_session_id;
      target.updated_at = new Date().toISOString();
      saveSoon();
      return true;
    },
    deleteSession(id) {
      const before = cache.sessions.length;
      cache.sessions = cache.sessions.filter((s) => s.id !== id);
      cache.messages = cache.messages.filter((m) => m.session_id !== id);
      const removed = before !== cache.sessions.length;
      if (removed) saveSoon();
      return removed;
    },
    getMessagesBySession(sessionId) {
      return cache.messages
        .filter((m) => m.session_id === sessionId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    createMessage(message) {
      cache.messages.push(message);
      const session = cache.sessions.find((s) => s.id === message.session_id);
      if (session) session.updated_at = new Date().toISOString();
      saveSoon();
      return message;
    },
    updateMessage(id, updates) {
      const target = cache.messages.find((m) => m.id === id);
      if (!target) return false;
      if (updates.content !== undefined) target.content = updates.content;
      if (updates.tool_calls !== undefined) target.tool_calls = updates.tool_calls;
      saveSoon();
      return true;
    },
    deleteMessage(id) {
      const before = cache.messages.length;
      cache.messages = cache.messages.filter((m) => m.id !== id);
      const removed = before !== cache.messages.length;
      if (removed) saveSoon();
      return removed;
    },
    createMessages(messages) {
      cache.messages.push(...messages);
      saveSoon();
    },
    clearAllData() {
      cache = { sessions: [], messages: [] };
      saveSoon();
    },
  };
}

/* ------------------------------------------------------------------ */
/* 选择驱动并导出                                                       */
/* ------------------------------------------------------------------ */

const store: ChatStore = tryLoadSqlite() ?? createJsonStore();

export const dbDriver = store.driver;

export function getAllSessions(): DbSession[] {
  return store.getAllSessions();
}
export function getSession(id: string): DbSession | undefined {
  return store.getSession(id);
}
export function createSession(session: DbSession): DbSession {
  return store.createSession(session);
}
export function updateSession(
  id: string,
  updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>,
): boolean {
  return store.updateSession(id, updates);
}
export function deleteSession(id: string): boolean {
  return store.deleteSession(id);
}
export function getMessagesBySession(sessionId: string): DbMessage[] {
  return store.getMessagesBySession(sessionId);
}
export function createMessage(message: DbMessage): DbMessage {
  return store.createMessage(message);
}
export function updateMessage(
  id: string,
  updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>,
): boolean {
  return store.updateMessage(id, updates);
}
export function deleteMessage(id: string): boolean {
  return store.deleteMessage(id);
}
export function createMessages(messages: DbMessage[]): void {
  store.createMessages(messages);
}
export function clearAllData(): void {
  store.clearAllData();
}

export default store;
