/**
 * 代理池存储层
 * ------------------------------------------------------------
 * - 落盘到 data/proxies.json（原子写 + 防抖）
 * - 提供合并去重、评分、淘汰、统计等能力
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Anonymity,
  EngineConfig,
  PoolStats,
  ProxyProtocol,
  ProxyRecord,
  TaskProgress,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = path.join(__dirname, '..', '..', 'data');
export const PROXY_FILE = path.join(DATA_DIR, 'proxies.json');
export const CONFIG_FILE = path.join(DATA_DIR, 'proxy-config.json');
export const CLASH_FILE = path.join(DATA_DIR, 'clash-proxies.yaml');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 从环境变量读取一个正整数，非法值回落到默认值。
 *
 * 注意语义：这些只作为**首次启动时的默认值**。引擎配置会持久化到 data/proxy-config.json，
 * 已有配置文件时以文件（也就是页面「引擎设置」里保存的值）为准 —— 改了 .env 不会覆盖用户
 * 在界面上调过的参数。这一点必须在文档里讲清楚，否则会出现「我改了 .env 怎么没反应」。
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const DEFAULT_CONFIG: EngineConfig = {
  autoSync: false,
  intervalMinutes: 30,
  concurrency: envInt('PROXY_CONCURRENCY', 120),
  timeoutMs: envInt('PROXY_TIMEOUT_MS', 6000),
  maxConsecutiveFail: envInt('PROXY_MAX_FAIL', 3),
  minScore: 20,
  exportLimit: 200,
  detectGeo: true,
  detectAnonymity: true,
};

export function makeId(protocol: ProxyProtocol, host: string, port: number): string {
  return `${protocol}://${host}:${port}`;
}

export function createRecord(
  protocol: ProxyProtocol,
  host: string,
  port: number,
  sourceKey: string,
): ProxyRecord {
  const now = new Date().toISOString();
  return {
    id: makeId(protocol, host, port),
    host,
    port,
    protocol,
    sources: [sourceKey],
    anonymity: 'unknown',
    latency: null,
    latencyAvg: null,
    jitter: null,
    status: 'unknown',
    checks: 0,
    success: 0,
    fail: 0,
    consecutiveFail: 0,
    score: 40,
    firstSeen: now,
    lastChecked: null,
    lastAlive: null,
  };
}

/**
 * 综合评分模型（0-100）
 *  - 延迟：越低越高分（权重 50）
 *  - 成功率：历史稳定性（权重 30）
 *  - 新鲜度：最近存活时间（权重 20）
 *  - 惩罚：连续失败 / 代理类型（SOCKS5 略优于 HTTP）
 */
export function computeScore(rec: ProxyRecord): number {
  if (rec.status === 'dead') return 0;
  if (rec.status === 'unknown') return 40;

  const latency = rec.latencyAvg ?? rec.latency ?? 3000;
  // 100ms 以内接近满分；3000ms 以上接近 0
  const latencyScore = clamp(100 - (latency - 100) / 29, 0, 100);

  const total = rec.success + rec.fail;
  const successRate = total === 0 ? 0.5 : rec.success / total;
  const reliabilityScore = clamp(successRate * 100, 0, 100);

  let freshnessScore = 60;
  if (rec.lastAlive) {
    const ageMin = (Date.now() - new Date(rec.lastAlive).getTime()) / 60000;
    freshnessScore = clamp(100 - ageMin * 0.12, 0, 100);
  }

  let score = latencyScore * 0.5 + reliabilityScore * 0.3 + freshnessScore * 0.2;

  if (rec.consecutiveFail > 0) score -= rec.consecutiveFail * 6;
  if (rec.protocol === 'socks5') score += 4;
  if (rec.protocol === 'https') score += 2;
  if (rec.anonymity === 'elite') score += 4;
  if (rec.anonymity === 'transparent') score -= 6;

  return Math.round(clamp(score, 0, 100));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/* ------------------------------------------------------------------ */
/* 池对象                                                             */
/* ------------------------------------------------------------------ */

/** 单个代理源的最近一次采集结果 */
export interface SourceReportEntry {
  ok: boolean;
  found: number;
  added: number;
  error?: string;
  at: string;
  ms: number;
}

export interface PoolMeta {
  lastFetchAt: string | null;
  lastTestAt: string | null;
  lastSyncAt: string | null;
  sourceReport: Record<string, SourceReportEntry>;
}

export class ProxyPool {
  private records = new Map<string, ProxyRecord>();
  private config: EngineConfig = { ...DEFAULT_CONFIG };
  private meta: PoolMeta = { lastFetchAt: null, lastTestAt: null, lastSyncAt: null, sourceReport: {} };

  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.load();
  }

  /* ---------------- 持久化 ---------------- */

  private load(): void {
    try {
      if (fs.existsSync(PROXY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(PROXY_FILE, 'utf8')) as {
          records?: ProxyRecord[];
          meta?: Partial<PoolMeta>;
        };
        for (const rec of raw.records ?? []) {
          this.records.set(rec.id, rec);
        }
        if (raw.meta) this.meta = { ...this.meta, ...raw.meta };
      }
    } catch (e) {
      console.warn('[Pool] 读取代理池失败，使用空池：', (e as Error).message);
    }
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
      }
    } catch {
      /* ignore */
    }
  }

  /** 防抖保存，避免高频写盘 */
  scheduleSave(delay = 1200): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), delay);
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      meta: this.meta,
      records: Array.from(this.records.values()),
    };
    const tmp = `${PROXY_FILE}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
      fs.renameSync(tmp, PROXY_FILE);
    } catch (e) {
      console.error('[Pool] 保存代理池失败：', (e as Error).message);
    }
  }

  saveConfig(): void {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.error('[Pool] 保存配置失败：', (e as Error).message);
    }
  }

  /* ---------------- 配置 ---------------- */

  getConfig(): EngineConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<EngineConfig>): EngineConfig {
    this.config = { ...this.config, ...patch };
    // 边界保护
    this.config.concurrency = clamp(this.config.concurrency, 1, 500);
    this.config.timeoutMs = clamp(this.config.timeoutMs, 1000, 30000);
    this.config.intervalMinutes = clamp(this.config.intervalMinutes, 1, 1440);
    this.config.maxConsecutiveFail = clamp(this.config.maxConsecutiveFail, 1, 20);
    this.config.minScore = clamp(this.config.minScore, 0, 100);
    this.config.exportLimit = clamp(this.config.exportLimit, 1, 5000);
    this.saveConfig();
    return this.getConfig();
  }

  /* ---------------- 查询 ---------------- */

  all(): ProxyRecord[] {
    return Array.from(this.records.values());
  }

  get(id: string): ProxyRecord | undefined {
    return this.records.get(id);
  }

  size(): number {
    return this.records.size;
  }

  list(filter?: {
    status?: string;
    protocol?: string;
    maxLatency?: number;
    keyword?: string;
    minScore?: number;
    limit?: number;
  }): ProxyRecord[] {
    let out = this.all();
    if (filter) {
      if (filter.status && filter.status !== 'all') {
        out = out.filter((r) => r.status === filter.status);
      }
      if (filter.protocol && filter.protocol !== 'all') {
        out = out.filter((r) => r.protocol === filter.protocol);
      }
      if (typeof filter.maxLatency === 'number' && filter.maxLatency > 0) {
        out = out.filter((r) => (r.latencyAvg ?? r.latency ?? 99999) <= filter.maxLatency!);
      }
      if (typeof filter.minScore === 'number' && filter.minScore > 0) {
        out = out.filter((r) => r.score >= filter.minScore!);
      }
      if (filter.keyword) {
        const kw = filter.keyword.toLowerCase();
        out = out.filter(
          (r) =>
            r.host.includes(kw) ||
            String(r.port).includes(kw) ||
            (r.country ?? '').toLowerCase().includes(kw) ||
            (r.city ?? '').toLowerCase().includes(kw) ||
            (r.isp ?? '').toLowerCase().includes(kw),
        );
      }
    }
    // 默认按评分降序
    out.sort((a, b) => b.score - a.score || (a.latencyAvg ?? 1e9) - (b.latencyAvg ?? 1e9));
    if (filter?.limit && filter.limit > 0) out = out.slice(0, filter.limit);
    return out;
  }

  /** 导出用：仅保留符合条件的活代理 */
  exportable(): ProxyRecord[] {
    const { minScore, exportLimit } = this.config;
    const alive = this.all()
      .filter((r) => r.status === 'alive' && r.score >= minScore)
      .sort((a, b) => b.score - a.score);
    return alive.slice(0, exportLimit);
  }

  stats(): PoolStats {
    const list = this.all();
    const alive = list.filter((r) => r.status === 'alive');
    const byProtocol: Record<string, number> = {};
    for (const r of list) {
      byProtocol[r.protocol] = (byProtocol[r.protocol] ?? 0) + 1;
    }
    const latencies = alive
      .map((r) => r.latencyAvg ?? r.latency)
      .filter((v): v is number => typeof v === 'number');
    return {
      total: list.length,
      alive: alive.length,
      dead: list.filter((r) => r.status === 'dead').length,
      unknown: list.filter((r) => r.status === 'unknown').length,
      byProtocol,
      avgLatency:
        latencies.length > 0
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : null,
      bestLatency: latencies.length > 0 ? Math.min(...latencies) : null,
      lastFetchAt: this.meta.lastFetchAt,
      lastTestAt: this.meta.lastTestAt,
      lastSyncAt: this.meta.lastSyncAt,
    };
  }

  sourceReport(): Record<string, SourceReportEntry> {
    return this.meta.sourceReport;
  }

  /* ---------------- 变更 ---------------- */

  /** 合并采集结果，返回新增数量 */
  merge(parsed: Array<{ host: string; port: number; protocol: ProxyProtocol }>, sourceKey: string): number {
    let added = 0;
    for (const p of parsed) {
      const id = makeId(p.protocol, p.host, p.port);
      const existing = this.records.get(id);
      if (existing) {
        if (!existing.sources.includes(sourceKey)) existing.sources.push(sourceKey);
        // 曾经判失效的节点被源站重新采集到，给一次复活机会 ——
        // status 只代表「上次检测的结论」，因此只要失败过就允许在下一轮重新验证，
        // 否则一旦某轮抖动，该节点就再也不会被默认流程测到。
        if (existing.status === 'dead' && existing.consecutiveFail >= 1) {
          existing.status = 'unknown';
          existing.consecutiveFail = 0;
        }
      } else {
        this.records.set(id, createRecord(p.protocol, p.host, p.port, sourceKey));
        added++;
      }
    }
    if (added > 0) this.scheduleSave();
    return added;
  }

  /** 写入探测结果 */
  applyProbe(
    id: string,
    result: {
      ok: boolean;
      latencyMs?: number;
      exitIp?: string;
      country?: string;
      countryCode?: string;
      region?: string;
      city?: string;
      isp?: string;
      anonymity?: Anonymity;
      reason?: string;
    },
  ): ProxyRecord | undefined {
    const rec = this.records.get(id);
    if (!rec) return undefined;
    const now = new Date().toISOString();
    rec.checks += 1;
    rec.lastChecked = now;

    if (result.ok) {
      rec.success += 1;
      rec.consecutiveFail = 0;
      rec.status = 'alive';
      rec.lastAlive = now;
      rec.lastError = undefined;
      if (typeof result.latencyMs === 'number') {
        rec.latency = result.latencyMs;
        const prev = rec.latencyAvg;
        // 指数移动平均，兼顾平滑与灵敏
        rec.latencyAvg = prev === null ? result.latencyMs : Math.round(prev * 0.6 + result.latencyMs * 0.4);
        rec.jitter = prev === null ? 0 : Math.round(Math.abs(prev - result.latencyMs));
      }
      if (result.exitIp) rec.exitIp = result.exitIp;
      if (result.country) rec.country = result.country;
      if (result.countryCode) rec.countryCode = result.countryCode;
      if (result.region) rec.region = result.region;
      if (result.city) rec.city = result.city;
      if (result.isp) rec.isp = result.isp;
      if (result.anonymity && result.anonymity !== 'unknown') rec.anonymity = result.anonymity;
    } else {
      rec.fail += 1;
      rec.consecutiveFail += 1;
      rec.latency = null;
      rec.latencyAvg = null;
      rec.jitter = null;
      rec.lastError = result.reason;
      // status 表示「最近一次检测的结论」，因此失败即置为 dead —— 前端的可用数/失效数
      // 必须如实反映本轮测速结果，否则用户看到的「未知」既不是可用也不是失效，无法判断有效性。
      // consecutiveFail 另行累计，只用于决定是否从池中彻底淘汰（容忍偶发抖动）。
      rec.status = 'dead';
      // 判定失效后，之前记录的出口 IP / 地理位置 / 匿名度已不可信
      // （尤其是一条曾因误判而带上 elite 标签的记录），必须清掉以免污染导出与统计
      rec.exitIp = undefined;
      rec.country = undefined;
      rec.countryCode = undefined;
      rec.region = undefined;
      rec.city = undefined;
      rec.isp = undefined;
      rec.anonymity = 'unknown';
    }
    rec.score = computeScore(rec);
    return rec;
  }

  /** 淘汰长期失效的节点 */
  prune(): number {
    const before = this.records.size;
    for (const [id, rec] of this.records) {
      if (rec.status === 'dead' && rec.consecutiveFail >= this.config.maxConsecutiveFail * 2) {
        this.records.delete(id);
      }
    }
    const removed = before - this.records.size;
    if (removed > 0) this.scheduleSave();
    return removed;
  }

  clear(): void {
    this.records.clear();
    this.meta.lastFetchAt = null;
    this.meta.lastTestAt = null;
    this.meta.lastSyncAt = null;
    this.meta.sourceReport = {};
    this.saveNow();
  }

  /** 删除单条 */
  remove(id: string): boolean {
    const ok = this.records.delete(id);
    if (ok) this.scheduleSave();
    return ok;
  }

  markFetch(): void {
    this.meta.lastFetchAt = new Date().toISOString();
    this.scheduleSave();
  }

  markTest(): void {
    this.meta.lastTestAt = new Date().toISOString();
    this.scheduleSave();
  }

  markSync(): void {
    this.meta.lastSyncAt = new Date().toISOString();
    this.scheduleSave();
  }

  setSourceReport(
    key: string,
    report: { ok: boolean; found: number; added: number; error?: string; ms: number },
  ): void {
    this.meta.sourceReport[key] = { ...report, at: new Date().toISOString() };
  }
}

export const pool = new ProxyPool();

/* ------------------------------------------------------------------ */
/* 任务进度（供 SSE 推送）                                             */
/* ------------------------------------------------------------------ */

export function createProgress(): TaskProgress {
  return {
    running: false,
    phase: 'idle',
    message: '空闲',
    current: 0,
    total: 0,
    startedAt: null,
    finishedAt: null,
    logs: [],
  };
}

export function pushLog(
  progress: TaskProgress,
  level: 'info' | 'success' | 'warn' | 'error',
  text: string,
): void {
  progress.logs.push({ at: new Date().toISOString(), level, text });
  if (progress.logs.length > 200) progress.logs.splice(0, progress.logs.length - 200);
}
