/**
 * 代理池相关类型（与 server/proxy/types.ts 保持结构一致）
 */

export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5';
export type ProxyStatus = 'unknown' | 'alive' | 'dead';
export type Anonymity = 'unknown' | 'transparent' | 'anonymous' | 'elite';

export interface ProxyRecord {
  id: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  sources: string[];
  exitIp?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  isp?: string;
  anonymity: Anonymity;
  latency: number | null;
  latencyAvg: number | null;
  jitter: number | null;
  status: ProxyStatus;
  checks: number;
  success: number;
  fail: number;
  consecutiveFail: number;
  score: number;
  firstSeen: string;
  lastChecked: string | null;
  lastAlive: string | null;
  lastError?: string;
}

export interface PoolStats {
  total: number;
  alive: number;
  dead: number;
  unknown: number;
  byProtocol: Record<string, number>;
  avgLatency: number | null;
  bestLatency: number | null;
  lastFetchAt: string | null;
  lastTestAt: string | null;
  lastSyncAt: string | null;
}

export interface EngineConfig {
  autoSync: boolean;
  intervalMinutes: number;
  concurrency: number;
  timeoutMs: number;
  maxConsecutiveFail: number;
  minScore: number;
  exportLimit: number;
  detectGeo: boolean;
  detectAnonymity: boolean;
}

export interface TaskProgress {
  running: boolean;
  phase: 'idle' | 'fetch' | 'test' | 'sync' | 'export';
  message: string;
  current: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  logs: Array<{ at: string; level: 'info' | 'success' | 'warn' | 'error'; text: string }>;
}

export interface SourceInfo {
  key: string;
  name: string;
  homepage: string;
  protocol: ProxyProtocol;
  kind: 'html' | 'text' | 'json';
  pages: number;
  note?: string;
  /** 实测失效或需 JS 挑战，默认不参与采集（显式点名该源时仍会尝试） */
  disabled: boolean;
  /** urls 为同一份数据的多线路镜像，采集时并发竞速 */
  mirrors: boolean;
  /** 该源的单次请求超时覆盖（毫秒） */
  timeoutMs?: number;
  urls: string[];
  report: {
    ok: boolean;
    found: number;
    added: number;
    error?: string;
    at: string;
    ms: number;
  } | null;
}

export interface TargetInfo {
  info: string | null;
  ping: string | null;
  localIp: string | null;
  /** 实际按顺序尝试的完整目标列表（命中第一个即止） */
  attempts?: string[];
  /** 本机直连探测确认可用的目标；未解析时为 null。判断「回显目标是否可达」看这里 */
  reachable?: { info: string | null; ping: string | null };
}

export type Phase = TaskProgress['phase'];
