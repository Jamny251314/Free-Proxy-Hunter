/**
 * 代理池引擎
 * ------------------------------------------------------------
 * 统一编排：采集 → 去重入库 → 并发测速 → 评分整合 → 导出 Clash
 * 通过 EventEmitter 向外广播进度，供 SSE 推送到前端。
 */

import { EventEmitter } from 'node:events';
import type {
  Anonymity,
  FetchOutcome,
  ProbeOutcome,
  ProxyRecord,
  TaskProgress,
} from './types.js';
import { SOURCES, parseSourcePayload, sanitizeParsed } from './sources.js';
import {
  INFO_TARGETS,
  PING_TARGETS,
  httpViaProxy,
  httpsViaProxy,
  inferAnonymity,
  isPublicIp,
  probeTargetDirect,
  getLocalPublicIp,
  type ProbeTarget,
} from './net.js';
import { createProgress, pool, pushLog } from './store.js';
import { dedupeForClash, writeClashFiles } from './clash.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** 采集用默认请求头 */
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/json,text/plain,*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/** 同一站点的分页之间的间隔 —— 连续快速请求会被判定为爬虫而返回空表/403 */
const PAGE_DELAY_MS = 350;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface RawFetch {
  body: string;
  contentType: string;
  url: string;
}

/** 抓取单个 URL 的文本正文 */
async function fetchUrl(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<RawFetch> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { body: await res.text(), contentType: res.headers.get('content-type') ?? '', url };
}

/**
 * 镜像竞速：并发请求同一份数据的多个镜像地址，取最先成功返回者，
 * 其余请求立即中断。用于 GitHub raw 及其各类镜像站 ——
 * 单一线路被墙不会导致整个源采集失败。
 */
async function raceFirstMirror(
  urls: string[],
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<RawFetch> {
  const controllers = urls.map(() => new AbortController());
  return new Promise<RawFetch>((resolve, reject) => {
    let settled = false;
    let remaining = urls.length;
    let lastError = '镜像全部不可用';

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      controllers.forEach((c) => c.abort());
      fn();
    };

    urls.forEach((url, i) => {
      const signal = AbortSignal.any([controllers[i].signal, AbortSignal.timeout(timeoutMs)]);
      fetch(url, { headers, signal, redirect: 'follow' })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.text();
          settle(() => resolve({ body, contentType: res.headers.get('content-type') ?? '', url }));
        })
        .catch((e: Error) => {
          lastError = e.name === 'TimeoutError' || e.name === 'AbortError' ? '请求超时' : e.message;
        })
        .finally(() => {
          remaining -= 1;
          if (remaining === 0) settle(() => reject(new Error(lastError)));
        });
    });
  });
}

export const engineEvents = new EventEmitter();
engineEvents.setMaxListeners(200);

export const progress: TaskProgress = createProgress();

/** 哪个任务在跑 */
let activeTask: 'fetch' | 'test' | 'sync' | null = null;

/** 自动择优出来的可用探测目标 */
interface ResolvedTargets {
  info: ProbeTarget | null;
  ping: ProbeTarget | null;
  localIp: string | null;
  resolvedAt: number;
}

const targets: ResolvedTargets = { info: null, ping: null, localIp: null, resolvedAt: 0 };

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

function emit(type: string, payload: Record<string, unknown> = {}): void {
  engineEvents.emit('event', { type, at: new Date().toISOString(), ...payload });
}

function setPhase(phase: TaskProgress['phase'], message: string, total = 0): void {
  progress.phase = phase;
  progress.running = phase !== 'idle';
  progress.message = message;
  progress.current = 0;
  progress.total = total;
  progress.startedAt = new Date().toISOString();
  progress.finishedAt = null;
  emit('progress', { progress: snapshotProgress() });
}

function finishPhase(message: string): void {
  progress.running = false;
  progress.phase = 'idle';
  progress.message = message;
  progress.finishedAt = new Date().toISOString();
  emit('progress', { progress: snapshotProgress() });
}

function log(level: 'info' | 'success' | 'warn' | 'error', text: string): void {
  pushLog(progress, level, text);
  emit('log', { level, text, at: new Date().toISOString() });
}

export function snapshotProgress(): TaskProgress {
  return { ...progress, logs: progress.logs.slice(-60) };
}

/** 并发池 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const n = Math.min(concurrency, items.length);
  for (let i = 0; i < n; i++) {
    runners.push(
      (async () => {
        while (true) {
          const index = cursor++;
          if (index >= items.length) return;
          await worker(items[index], index);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/* ------------------------------------------------------------------ */
/* 探测目标择优                                                       */
/* ------------------------------------------------------------------ */

let resolving: Promise<ResolvedTargets> | null = null;

export async function resolveTargets(force = false): Promise<ResolvedTargets> {
  const fresh = Date.now() - targets.resolvedAt < 10 * 60 * 1000;
  if (!force && fresh && (targets.info || targets.ping)) return targets;
  // 首次解析时并发调用会重复探测，这里做单飞处理
  if (resolving) return resolving;

  resolving = (async () => {
    await doResolveTargets();
    return targets;
  })().finally(() => {
    resolving = null;
  });
  return resolving;
}

async function doResolveTargets(): Promise<void> {
  log('info', '正在探测可用的测速目标节点…');
  // 代理探测统一走 httpViaProxy（absolute-form GET），只接受 http:// 目标 ——
  // 这是兼容性最好的方式，能验证到最多的免费代理。
  // HTTPS / CONNECT 的能力由 /api/proxy/test-https 单独校验，不混进主探测链路，
  // 否则大量只支持明文转发的免费代理会被误判为不可用。
  const httpInfoTargets = INFO_TARGETS.filter((t) => t.url.startsWith('http://'));
  let info: ProbeTarget | null = null;
  for (const t of httpInfoTargets) {
    if (await probeTargetDirect(t, 5000)) {
      info = t;
      break;
    }
  }
  if (!info) {
    log('warn', '没有可直连的 http:// 信息回显目标，将退回仅做连通性测速（拿不到出口 IP 与地区）');
  }
  let ping: ProbeTarget | null = null;
  for (const t of PING_TARGETS) {
    if (await probeTargetDirect(t, 5000)) {
      ping = t;
      break;
    }
  }
  // ip 信息目标本身也能当延迟目标用
  const localIp = await getLocalPublicIp(6000);

  targets.info = info;
  targets.ping = ping ?? info;
  targets.localIp = localIp;
  targets.resolvedAt = Date.now();

  const order = probeAttemptOrder(pool.getConfig().detectGeo);
  log(
    info ? 'success' : 'warn',
    info
      ? `测速目标已就绪：将按顺序依次尝试 ${order.length} 个目标，命中第一个即止（本机可直连的信息回显目标：${info.url}）`
      : '未找到可直连的信息回显目标，将仅做连通性测速',
  );
  if (localIp) log('info', `本机公网出口 IP：${localIp}（用于匿名度判定）`);
}

/**
 * 计算一次探测实际会「按顺序依次尝试」的目标列表。
 *
 * probeProxy 与 targetStatus 共用同一个函数，保证**对外展示的目标与真正使用的目标一致**。
 * 之前 targetStatus 报的是「本机直连择优结果」，而 probeProxy 实际用的却是固定声明顺序，
 * 于是接口报 cip.cc、真正先试的却是 ipip —— 前端和 Agent 都据接口下判断，这种不一致会直接
 * 导致错误结论（例如据此认定「延迟是按 cip.cc 测的」）。
 *
 * 顺序 = 信息丰富度：先试同时给出「出口 IP + 国家/省/市/ISP」的目标，再退到只回显 IP 的
 * 3322，最后才是纯连通性目标。为什么不是「只用择优出的那一个」：ipip 走代理时常被回 301，
 * 一旦此时直接跳到只回显 IP 的目标，节点就会有出口 IP 却查不到地区，前端「地区」列整片空白。
 *
 * 为什么**不**把择优结果插到最前面：择优只看「本机直连能否打通」，而直连失败并不能预测它
 * 经由代理会失败（实测 ipip 直连探测失败的同时，走代理仍是 200 / 39 字节 / 108ms）。
 * 而 cip.cc 的页面有 3447 字节，同一代理下要 3897ms —— 一旦让它做首个探测目标，全池的
 * 「延迟」都会按它来测，数值被严重放大，进而扭曲评分与节点排序。固定按声明顺序尝试，
 * 才能保证延迟口径一致且贴近真实。
 */
function probeAttemptOrder(detectGeo: boolean): ProbeTarget[] {
  const list: ProbeTarget[] = [];
  const push = (candidate: ProbeTarget | null): void => {
    // httpViaProxy 只接受 http:// 目标，https 目标会直接抛错，加进来只会白耗一轮超时
    if (!candidate || !candidate.url.startsWith('http://')) return;
    if (list.some((a) => a.url === candidate.url)) return;
    list.push(candidate);
  };
  // detectGeo=false 时连信息目标一起跳过：这些目标存在的意义就是补地区，
  // 关掉地区采集还去请求它们只是白白多花一轮超时
  if (detectGeo) {
    for (const it of INFO_TARGETS) push(it);
  }
  for (const p of PING_TARGETS) push(p);
  return list;
}

export function targetStatus(): {
  info: string | null;
  ping: string | null;
  localIp: string | null;
  /** 实际按顺序尝试的完整目标列表（命中第一个即止）—— 与 probeProxy 同源 */
  attempts: string[];
  /** 本机**直连探测**确认可用的目标；未解析时为 null */
  reachable: { info: string | null; ping: string | null };
} {
  const order = probeAttemptOrder(pool.getConfig().detectGeo);
  const infoUrls = new Set(INFO_TARGETS.map((t) => t.url));
  return {
    // info 取实际尝试顺序里的第一个信息类目标 —— 它才是真正定义「延迟口径」的那个
    info: order.find((t) => infoUrls.has(t.url))?.url ?? null,
    /**
     * ping 是**静态列表**里第一个「纯连通性」目标，不代表它在
     * 本机可达：列表尾部有 connectivitycheck.gstatic.com/generate_204 这类境内常年打不通的目标，
     * 而 ip.3322.net / www.cip.cc 虽同为纯 IP 回显，却因为同时登记在 INFO_TARGETS 里而被归为信息目标。
     * 因此**不要**拿 ping 判断「回显目标是否可达」——那是 reachable 的职责，
     * 它来自 resolveTargets() 的真实直连探测结果。
     */
    ping: order.find((t) => !infoUrls.has(t.url))?.url ?? null,
    localIp: targets.localIp,
    attempts: order.map((t) => t.url),
    reachable: { info: targets.info?.url ?? null, ping: targets.ping?.url ?? null },
  };
}

/* ------------------------------------------------------------------ */
/* 1. 采集                                                             */
/* ------------------------------------------------------------------ */

async function fetchOneSource(
  source: (typeof SOURCES)[number],
): Promise<FetchOutcome> {
  const started = Date.now();
  const headers = { ...DEFAULT_HEADERS, ...(source.headers ?? {}) };
  const timeoutMs = source.timeoutMs ?? 15000;
  const pages = source.pages ?? 1;

  const collected: Array<{ host: string; port: number; protocol: ProxyRecord['protocol'] }> = [];
  let lastError: string | undefined;

  /** 解析一个响应并累积结果，返回本页新增条数 */
  const absorb = (raw: RawFetch): number => {
    const parsed = sanitizeParsed(parseSourcePayload(source, raw.body, raw.contentType));
    if (parsed.length > 0) collected.push(...parsed);
    return parsed.length;
  };

  if (source.mirrors) {
    // 镜像源：多线路竞速，取最快可用者
    try {
      absorb(await raceFirstMirror(source.urls, headers, timeoutMs));
    } catch (e) {
      lastError = (e as Error).message;
    }
  } else {
    // 分页源：串行抓取 + 页间间隔，避免同站并发触发风控
    const urls: string[] = [];
    for (const tpl of source.urls) {
      if (tpl.includes('{page}')) {
        for (let p = 1; p <= pages; p++) urls.push(tpl.replace('{page}', String(p)));
      } else {
        urls.push(tpl);
      }
    }

    let emptyStreak = 0;
    for (let i = 0; i < urls.length; i++) {
      let pageHits = 0;
      try {
        pageHits = absorb(await fetchUrl(urls[i], headers, timeoutMs));
      } catch (e) {
        lastError = (e as Error).message;
      }
      // 连续两页空表说明已翻到尾部，提前结束，避免无谓请求
      emptyStreak = pageHits === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= 2 && i >= 1) break;
      if (i < urls.length - 1) await sleep(PAGE_DELAY_MS);
    }
  }

  const added = pool.merge(collected, source.key);
  const ms = Date.now() - started;
  const ok = collected.length > 0;
  pool.setSourceReport(source.key, { ok, found: collected.length, added, error: ok ? undefined : lastError, ms });

  return {
    key: source.key,
    name: source.name,
    ok,
    found: collected.length,
    added,
    error: ok ? undefined : lastError,
    ms,
  };
}

export async function runFetch(
  sources = SOURCES,
  opts: { includeDisabled?: boolean } = {},
): Promise<FetchOutcome[]> {
  // 实测已失效 / 需要 JS 挑战的源直接跳过，避免无效请求拖慢整轮采集
  // （用户显式点名某个源时例外，便于手动排查该源是否已恢复）
  const active = opts.includeDisabled ? sources : sources.filter((s) => !s.disabled);
  const skipped = sources.length - active.length;

  if (active.length === 0) throw new Error('没有可用的代理源');
  if (activeTask) throw new Error(`已有任务在执行（${activeTask}），请稍后重试`);
  activeTask = 'fetch';
  setPhase('fetch', '正在全网抓取免费代理…', active.length);
  log('info', `开始抓取 ${active.length} 个代理源${skipped > 0 ? `（已跳过 ${skipped} 个失效源）` : ''}…`);

  try {
    const outcomes: FetchOutcome[] = [];
    let done = 0;
    // 源之间并发度控制在 8，避免触发风控
    await runPool(active, 8, async (source) => {
      const outcome = await fetchOneSource(source);
      outcomes.push(outcome);
      done++;
      progress.current = done;
      emit('source', { outcome });
      emit('progress', { progress: snapshotProgress() });
      if (outcome.ok) {
        log('success', `${outcome.name}：发现 ${outcome.found} 条（新增 ${outcome.added}）`);
      } else {
        log('warn', `${outcome.name}：采集失败 ${outcome.error ?? '未解析到代理条目'}`);
      }
    });

    pool.markFetch();
    pool.scheduleSave(300);
    const totalFound = outcomes.reduce((a, b) => a + b.found, 0);
    finishPhase(`抓取完成：共发现 ${totalFound} 条，去重后池内 ${pool.size()} 条`);
    log('success', `抓取完成，池内共 ${pool.size()} 条代理`);
    emit('pool', { stats: pool.stats() });
    return outcomes;
  } finally {
    // 无论成功失败都释放任务锁，避免引擎被永久占用
    activeTask = null;
  }
}

/* ------------------------------------------------------------------ */
/* 2. 测速验证                                                         */
/* ------------------------------------------------------------------ */

export interface TestOptions {
  /** 选择要测的范围 */
  scope?: 'all' | 'unknown' | 'alive' | 'stale';
  /** 覆盖全局并发 */
  concurrency?: number;
  /** 覆盖全局超时 */
  timeoutMs?: number;
  /** 只测指定 ID */
  ids?: string[];
  /** 每个节点重复次数（取最好成绩） */
  rounds?: number;
}

/** 探测单个代理 */
export async function probeProxy(
  rec: ProxyRecord,
  timeoutMs: number,
  opts: { detectGeo: boolean; detectAnonymity: boolean },
): Promise<ProbeOutcome> {
  const proxy = { host: rec.host, port: rec.port, protocol: rec.protocol };
  const t = await resolveTargets();
  const pingTarget = t.ping;

  // 尝试顺序统一由 probeAttemptOrder 给出（与 /api/proxy/targets 对外报的目标同源）
  const attempts = probeAttemptOrder(opts.detectGeo);

  // 单节点总时间预算：防止一个「所有目标都超时」的死节点把 N 个目标的超时时间
  // 全额耗光（8 个目标 × 6s ≈ 48s）。可用代理在第 1~2 个目标就会命中，因此这个
  // 上限实际上只对死节点生效，不会误伤「慢但可用」的节点。
  const budgetMs = Math.max(Math.round(timeoutMs * 2.5), 3000);
  const deadline = Date.now() + budgetMs;

  let lastReason = '全部目标不可达';
  // 统计「连续超时」次数：绝大多数死节点是黑洞丢包（SYN 被吞、不明确拒绝），
  // 只能靠超时判定。把这一点直接写进失败原因，比笼统地说「预算用尽」更如实 ——
  // 后者会让人误以为是引擎限制，而实际上那就是节点本身的性质。
  let timeouts = 0;
  let onlyTimeouts = true;
  for (const target of attempts) {
    if (Date.now() > deadline) {
      lastReason =
        onlyTimeouts && timeouts > 0
          ? `${timeouts} 个目标均无响应（单目标超时 ${Math.round(timeoutMs / 1000)}s，判定不可达）`
          : `探测时间预算已用尽，最后结果：${lastReason}`;
      break;
    }
    try {
      const { response, latencyMs } = await httpViaProxy(proxy, target.url, timeoutMs);
      // 拿到响应即说明链路没有被黑洞吞掉，后续失败原因以具体结论为准
      onlyTimeouts = false;
      if (response.statusCode === 0) {
        lastReason = '无有效 HTTP 响应';
        continue;
      }
      if (target.accept && target.accept.length > 0 && !target.accept.includes(response.statusCode)) {
        lastReason = `状态码 ${response.statusCode}`;
        continue;
      }
      if (response.statusCode >= 400) {
        lastReason = `状态码 ${response.statusCode}`;
        continue;
      }
      // 3xx 一律判不可用，不做跟跳。所有探测目标都直接返回 200，链路正常的代理
      // 不会产生需要客户端跟随的跳转；而「把请求主机名回显到通用跳转页」恰恰是
      // 假存活最典型的形状（跳转页正文里的 <a HREF="...目标主机..."> 会让任何
      // 「正文含目标名」的弱校验恒为真）。在这里一刀切断整类响应，不必指望每个
      // 目标的 verify 都写得足够严。
      if (response.statusCode >= 300) {
        lastReason = `重定向 ${response.statusCode}（未跟随）`;
        continue;
      }
      // 内容校验：排除「普通站点把 absolute-form 请求当自家页面返回 200」的假存活
      if (target.verify && !target.verify(response)) {
        lastReason = '响应内容与目标不符';
        continue;
      }

      const parsed = target.parse(response);
      // 信息类目标必须解析出合法公网出口 IP
      if (target.requireIp && !isPublicIp(parsed.exitIp)) {
        lastReason = parsed.exitIp ? `出口 IP 非法（${parsed.exitIp}）` : '未解析到出口 IP';
        continue;
      }
      // 只有「能暴露出口 IP」的目标才具备判定匿名度的条件：
      // 出口 IP 与代理自身地址相同 → anonymous，不同 → elite（请求头泄露则 transparent）
      const anonymity: Anonymity =
        opts.detectAnonymity && target.requireIp && parsed.exitIp
          ? inferAnonymity(response, parsed.exitIp, rec.host)
          : 'unknown';

      return {
        ok: true,
        latencyMs,
        statusCode: response.statusCode,
        exitIp: parsed.exitIp,
        country: parsed.country,
        countryCode: parsed.countryCode,
        region: parsed.region,
        city: parsed.city,
        isp: parsed.isp,
        anonymity,
      };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('超时')) timeouts++;
      lastReason = msg;
    }
  }

  // 纯延迟目标兜底（当信息目标不可用）—— 同样需要内容校验
  if (pingTarget && !attempts.some((a) => a.url === pingTarget.url)) {
    try {
      const { response, latencyMs } = await httpViaProxy(proxy, pingTarget.url, timeoutMs);
      const accepted =
        response.statusCode > 0 &&
        response.statusCode < 300 &&
        (!pingTarget.accept || pingTarget.accept.includes(response.statusCode)) &&
        (!pingTarget.verify || pingTarget.verify(response));
      if (accepted) {
        const parsed = pingTarget.parse(response);
        if (!pingTarget.requireIp || isPublicIp(parsed.exitIp)) {
          return {
            ok: true,
            latencyMs,
            statusCode: response.statusCode,
            exitIp: parsed.exitIp,
            // 兜底路径同样要带回地理信息 —— 否则「能拿到地区」完全取决于
            // 哪条路径命中，同一批节点会出现有的有地区、有的没有
            country: parsed.country,
            countryCode: parsed.countryCode,
            region: parsed.region,
            city: parsed.city,
            isp: parsed.isp,
            anonymity: 'unknown',
          };
        }
      }
    } catch (e) {
      lastReason = (e as Error).message;
    }
  }

  return { ok: false, latencyMs: 0, anonymity: 'unknown', reason: lastReason };
}

/** 对 HTTPS 目标额外校验（判断是否能用于加密流量） */
export async function probeHttps(rec: ProxyRecord, timeoutMs: number): Promise<ProbeOutcome> {
  const proxy = { host: rec.host, port: rec.port, protocol: rec.protocol };
  try {
    const url = 'https://www.cloudflare.com/cdn-cgi/trace';
    const { response, latencyMs } = await httpsViaProxy(proxy, url, timeoutMs);
    if (response.statusCode > 0 && response.statusCode < 400) {
      const ipMatch = /ip=([0-9a-fA-F:.]+)/.exec(response.body);
      return {
        ok: true,
        latencyMs,
        statusCode: response.statusCode,
        exitIp: ipMatch?.[1],
        anonymity: 'unknown',
      };
    }
    return { ok: false, latencyMs: 0, anonymity: 'unknown', reason: `HTTPS 状态码 ${response.statusCode}` };
  } catch (e) {
    return { ok: false, latencyMs: 0, anonymity: 'unknown', reason: (e as Error).message };
  }
}

/** 批量测速 */
export async function runTest(options: TestOptions = {}): Promise<{
  tested: number;
  alive: number;
  dead: number;
}> {
  if (activeTask) throw new Error(`已有任务在执行（${activeTask}），请稍后重试`);
  activeTask = 'test';
  try {
    return await doRunTest(options);
  } finally {
    // 无论成功失败都释放任务锁
    activeTask = null;
  }
}

async function doRunTest(options: TestOptions): Promise<{
  tested: number;
  alive: number;
  dead: number;
}> {
  const cfg = pool.getConfig();
  const scope = options.scope ?? 'unknown';
  const concurrency = options.concurrency ?? cfg.concurrency;
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs;
  const rounds = Math.max(1, Math.min(options.rounds ?? 1, 3));

  let list: ProxyRecord[];
  if (options.ids && options.ids.length > 0) {
    list = options.ids.map((id) => pool.get(id)).filter((r): r is ProxyRecord => Boolean(r));
  } else {
    const now = Date.now();
    switch (scope) {
      case 'all':
        list = pool.all();
        break;
      case 'alive':
        list = pool.all().filter((r) => r.status === 'alive');
        break;
      case 'stale':
        list = pool
          .all()
          .filter((r) => !r.lastChecked || now - new Date(r.lastChecked).getTime() > 10 * 60 * 1000);
        break;
      case 'unknown':
      default:
        // 默认只测「还没确认可用的」：从未测过的 + 已判失效的。
        // 刚验证通过的节点不重复消耗时间；需要整池复验时用 scope=all（同步流程就走 all）。
        list = pool.all().filter((r) => r.status !== 'alive');
        break;
    }
  }

  setPhase('test', `正在测速验证 ${list.length} 条代理…`, list.length);
  log('info', `开始测速：共 ${list.length} 条，并发 ${concurrency}，超时 ${timeoutMs}ms`);

  await resolveTargets();

  let done = 0;
  let alive = 0;
  let dead = 0;

  // 逐条推送 SSE 在大池下会拖慢前端，这里做批量聚合
  type ProbeEvent = {
    id: string;
    ok: boolean;
    latency: number;
    status?: string;
    score?: number;
    country?: string;
    city?: string;
    anonymity?: string;
    reason?: string;
  };
  let probeBuffer: ProbeEvent[] = [];
  const flushProbes = (force = false) => {
    if (probeBuffer.length === 0) return;
    if (!force && probeBuffer.length < 25) return;
    emit('probe-batch', { items: probeBuffer });
    probeBuffer = [];
  };

  await runPool(list, concurrency, async (rec) => {
    let best: ProbeOutcome | null = null;
    for (let i = 0; i < rounds; i++) {
      const r = await probeProxy(rec, timeoutMs, {
        detectGeo: cfg.detectGeo,
        detectAnonymity: cfg.detectAnonymity,
      });
      if (!best || (!best.ok && r.ok) || (best.ok && r.ok && r.latencyMs < best.latencyMs)) {
        best = r;
      }
      if (best.ok && rounds === 1) break;
    }
    const result = best ?? { ok: false, latencyMs: 0, anonymity: 'unknown' as Anonymity, reason: '未知错误' };

    const updated = pool.applyProbe(rec.id, {
      ok: result.ok,
      latencyMs: result.latencyMs,
      exitIp: result.exitIp,
      country: result.country,
      countryCode: result.countryCode,
      region: result.region,
      city: result.city,
      isp: result.isp,
      anonymity: result.anonymity,
      reason: result.reason,
    });

    if (result.ok) alive++;
    else dead++;
    done++;

    progress.current = done;
    if (updated) {
      probeBuffer.push({
        id: rec.id,
        ok: result.ok,
        latency: result.latencyMs,
        status: updated.status,
        score: updated.score,
        country: updated.country,
        city: updated.city,
        anonymity: updated.anonymity,
        reason: result.reason,
      });
    }
    flushProbes();
    // 每 5 条推一次进度，降低 SSE 压力
    if (done % 5 === 0 || done === list.length) {
      emit('progress', { progress: snapshotProgress() });
    }
  });

  flushProbes(true);

  pool.markTest();
  pool.scheduleSave(300);
  const pruned = pool.prune();

  finishPhase(`测速完成：存活 ${alive} 条 / 失效 ${dead} 条`);
  log('success', `测速完成，存活 ${alive}，失效 ${dead}${pruned > 0 ? `，淘汰 ${pruned} 条长期失效节点` : ''}`);

  // 自动同步导出 Clash 配置
  const exportable = dedupeForClash(pool.exportable());
  if (exportable.length > 0) {
    const { path } = writeClashFiles(exportable);
    log('info', `已自动刷新 Clash 配置：${exportable.length} 个节点 → ${path}`);
  }

  emit('pool', { stats: pool.stats() });
  return { tested: list.length, alive, dead };
}

/* ------------------------------------------------------------------ */
/* 3. 一键同步（采集 + 测速 + 整合导出）                                */
/* ------------------------------------------------------------------ */

export async function runSync(): Promise<{
  sources: FetchOutcome[];
  tested: number;
  alive: number;
  exported: number;
}> {
  if (activeTask) throw new Error(`已有任务在执行（${activeTask}），请稍后重试`);
  const sources = await runFetch();
  // 同步是「跑一轮完整刷新」，因此整池复验（含上一轮已通过但可能已失效的节点），
  // 保证导出结果只包含本轮真实可用的节点
  const result = await runTest({ scope: 'all' });
  pool.markSync();
  const exported = buildAndStampExport();
  log('success', `一键同步完成：可用 ${exported.count} 个节点已写入 Clash 配置`);
  emit('sync-done', { sources: sources.length, ...result, exported: exported.count });
  return { sources, tested: result.tested, alive: result.alive, exported: exported.count };
}

function buildAndStampExport(): { count: number; path: string } {
  const records = dedupeForClash(pool.exportable());
  const res = writeClashFiles(records);
  pool.markSync();
  emit('pool', { stats: pool.stats() });
  return { count: records.length, path: res.path };
}

/** 仅重新生成导出文件（不重新测速） */
export function exportNow(): { count: number; path: string } {
  return buildAndStampExport();
}

/* ------------------------------------------------------------------ */
/* 4. 运行时自动更新                                                   */
/* ------------------------------------------------------------------ */

let timer: NodeJS.Timeout | null = null;

export function applySchedule(): void {
  const cfg = pool.getConfig();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!cfg.autoSync) {
    log('info', '自动更新已关闭');
    return;
  }
  const ms = Math.max(1, cfg.intervalMinutes) * 60 * 1000;
  timer = setInterval(() => {
    if (activeTask) {
      log('warn', '自动更新跳过：上一轮任务尚未结束');
      return;
    }
    log('info', '⏰ 触发自动更新（采集 + 测速 + 整合）');
    runSync().catch((e: Error) => log('error', `自动更新失败：${e.message}`));
  }, ms);
  log('success', `自动更新已开启，每 ${cfg.intervalMinutes} 分钟执行一次`);
}

export function isBusy(): boolean {
  return activeTask !== null;
}

export function currentTask(): string | null {
  return activeTask;
}
