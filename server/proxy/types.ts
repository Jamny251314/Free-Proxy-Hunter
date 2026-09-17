/**
 * 代理池核心类型定义
 */

export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5';

export type ProxyStatus = 'unknown' | 'alive' | 'dead';

export type Anonymity = 'unknown' | 'transparent' | 'anonymous' | 'elite';

/** 一条代理记录 */
export interface ProxyRecord {
  /** 唯一 ID: protocol://host:port */
  id: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  /** 来源站点 key 列表 */
  sources: string[];
  /** 最近一次检测结果 */
  exitIp?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  isp?: string;
  anonymity: Anonymity;
  /** 单次连接延迟（毫秒） */
  latency: number | null;
  /** 最近若干次延迟的移动平均 */
  latencyAvg: number | null;
  /** 抖动（延迟标准差，越小越稳定） */
  jitter: number | null;
  status: ProxyStatus;
  /** 检测次数 */
  checks: number;
  success: number;
  fail: number;
  /** 连续失败次数，达到阈值后淘汰 */
  consecutiveFail: number;
  /** 综合评分 0-100 */
  score: number;
  firstSeen: string;
  lastChecked: string | null;
  lastAlive: string | null;
  /** 失败原因（最近一次） */
  lastError?: string;
}

/** 数据源定义 */
export interface ProxySourceDef {
  /** 稳定标识 */
  key: string;
  /** 展示名 */
  name: string;
  /** 站点主页（展示用） */
  homepage: string;
  /** 默认协议 */
  protocol: ProxyProtocol;
  /** 采集类型 */
  kind: 'html' | 'text' | 'json';
  /** 需要抓取的 URL 列表（可含 {page} 占位符） */
  urls: string[];
  /** 分页数 */
  pages?: number;
  /** 简介 */
  note?: string;
  /** 是否需要跳过（例如需要 JS 渲染） */
  disabled?: boolean;
  /** 该源专用的请求头（覆盖默认值），用于绕开部分站点的反爬 */
  headers?: Record<string, string>;
  /**
   * urls 是否为同一份数据的镜像地址。
   * 为 true 时并发竞速取最快可用者，而非逐个串行尝试 —— 用于 GitHub raw + 各类镜像站。
   */
  mirrors?: boolean;
  /** 该源的单次请求超时覆盖（毫秒） */
  timeoutMs?: number;
}

/** 采集结果 */
export interface FetchOutcome {
  key: string;
  name: string;
  ok: boolean;
  found: number;
  added: number;
  error?: string;
  ms: number;
}

/** 单次探测结果 */
export interface ProbeOutcome {
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
  exitIp?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  isp?: string;
  anonymity: Anonymity;
  reason?: string;
}

/** 引擎可调参数 */
export interface EngineConfig {
  /** 是否开启运行时自动更新 */
  autoSync: boolean;
  /** 自动更新间隔（分钟） */
  intervalMinutes: number;
  /** 测速并发数 */
  concurrency: number;
  /** 单次探测超时（毫秒） */
  timeoutMs: number;
  /** 连续失败多少次后淘汰 */
  maxConsecutiveFail: number;
  /** 低于该评分的代理在导出时剔除 */
  minScore: number;
  /** 导出时最多包含多少条 */
  exportLimit: number;
  /** 自动化流程是否顺带采集地理解析 */
  detectGeo: boolean;
  /** 是否校验匿名度 */
  detectAnonymity: boolean;
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

export interface TaskProgress {
  running: boolean;
  phase: 'idle' | 'fetch' | 'test' | 'sync' | 'export';
  message: string;
  current: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** 最近若干条日志 */
  logs: Array<{ at: string; level: 'info' | 'success' | 'warn' | 'error'; text: string }>;
}
