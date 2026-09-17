/**
 * 代理池 REST API + SSE 事件流
 * ------------------------------------------------------------
 * 挂载到主 Express 服务，路径统一以 /api/proxy 开头。
 */

import type { Express, Request, Response } from 'express';
import { SOURCES } from './sources.js';
import { pool } from './store.js';
import { CLASH_FILE } from '../paths.js';
import {
  engineEvents,
  exportNow,
  isBusy,
  currentTask,
  resolveTargets,
  runFetch,
  runTest,
  runSync,
  snapshotProgress,
  targetStatus,
  probeProxy,
  probeHttps,
  applySchedule,
} from './engine.js';
import {
  buildClashConfig,
  buildProviderSnippet,
  buildProviderYaml,
  dedupeForClash,
} from './clash.js';

export function registerProxyRoutes(app: Express): void {
  /* ------------------------- 只读查询 ------------------------- */

  app.get('/api/proxy/pool', (req: Request, res: Response) => {
    const q = req.query;
    const records = pool.list({
      status: typeof q.status === 'string' ? q.status : undefined,
      protocol: typeof q.protocol === 'string' ? q.protocol : undefined,
      maxLatency: q.maxLatency ? Number(q.maxLatency) : undefined,
      minScore: q.minScore ? Number(q.minScore) : undefined,
      keyword: typeof q.keyword === 'string' ? q.keyword : undefined,
      limit: q.limit ? Number(q.limit) : 500,
    });
    res.json({
      records,
      stats: pool.stats(),
      config: pool.getConfig(),
      progress: snapshotProgress(),
      busy: isBusy(),
      task: currentTask(),
      targets: targetStatus(),
    });
  });

  app.get('/api/proxy/stats', (_req: Request, res: Response) => {
    res.json({ stats: pool.stats(), busy: isBusy(), task: currentTask(), progress: snapshotProgress() });
  });

  app.get('/api/proxy/sources', (_req: Request, res: Response) => {
    const report = pool.sourceReport();
    res.json({
      sources: SOURCES.map((s) => ({
        key: s.key,
        name: s.name,
        homepage: s.homepage,
        protocol: s.protocol,
        kind: s.kind,
        pages: s.pages ?? 1,
        note: s.note,
        disabled: s.disabled ?? false,
        mirrors: s.mirrors ?? false,
        timeoutMs: s.timeoutMs,
        urls: s.urls,
        report: report[s.key] ?? null,
      })),
    });
  });

  app.get('/api/proxy/targets', async (_req: Request, res: Response) => {
    try {
      await resolveTargets();
    } catch {
      /* 忽略：目标择优失败不阻塞返回 */
    }
    res.json({ targets: targetStatus() });
  });

  /* ------------------------- 配置 ------------------------- */

  app.get('/api/proxy/config', (_req: Request, res: Response) => {
    res.json({ config: pool.getConfig() });
  });

  app.patch('/api/proxy/config', (req: Request, res: Response) => {
    try {
      const config = pool.updateConfig(req.body ?? {});
      applySchedule();
      res.json({ config });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  /* ------------------------- 动作 ------------------------- */

  app.post('/api/proxy/fetch', async (req: Request, res: Response) => {
    try {
      const keys: string[] | undefined = req.body?.sources;
      const explicit = !!(keys && keys.length > 0);
      const list = explicit ? SOURCES.filter((s) => keys!.includes(s.key)) : SOURCES;
      if (list.length === 0) {
        return res.status(400).json({ error: '未匹配到任何代理源' });
      }
      // 显式点名时连同默认跳过的源一起抓，方便确认某个源是否已恢复可用
      const outcomes = await runFetch(list, { includeDisabled: explicit });
      res.json({
        outcomes,
        stats: pool.stats(),
        totalFound: outcomes.reduce((a, b) => a + b.found, 0),
        totalAdded: outcomes.reduce((a, b) => a + b.added, 0),
      });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  app.post('/api/proxy/test', async (req: Request, res: Response) => {
    try {
      const result = await runTest({
        scope: req.body?.scope,
        concurrency: req.body?.concurrency ? Number(req.body.concurrency) : undefined,
        timeoutMs: req.body?.timeoutMs ? Number(req.body.timeoutMs) : undefined,
        ids: Array.isArray(req.body?.ids) ? req.body.ids : undefined,
        rounds: req.body?.rounds ? Number(req.body.rounds) : undefined,
      });
      res.json({ ...result, stats: pool.stats() });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  app.post('/api/proxy/sync', async (_req: Request, res: Response) => {
    try {
      const result = await runSync();
      res.json({ ...result, stats: pool.stats() });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  /** 单条重测 */
  app.post('/api/proxy/test-one', async (req: Request, res: Response) => {
    const id: string | undefined = req.body?.id;
    if (!id) return res.status(400).json({ error: '缺少 id' });
    const rec = pool.get(id);
    if (!rec) return res.status(404).json({ error: '代理不存在' });
    const cfg = pool.getConfig();
    await resolveTargets();
    const result = await probeProxy(rec, cfg.timeoutMs, {
      detectGeo: cfg.detectGeo,
      detectAnonymity: cfg.detectAnonymity,
    });
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
    pool.scheduleSave(200);
    engineEvents.emit('event', { type: 'probe', id: rec.id, ok: result.ok, latency: result.latencyMs, status: updated?.status, score: updated?.score });
    engineEvents.emit('event', { type: 'pool', stats: pool.stats() });
    res.json({ record: updated, result });
  });

  /** HTTPS 可用性校验（判断能否用于加密流量） */
  app.post('/api/proxy/test-https', async (req: Request, res: Response) => {
    const id: string | undefined = req.body?.id;
    if (!id) return res.status(400).json({ error: '缺少 id' });
    const rec = pool.get(id);
    if (!rec) return res.status(404).json({ error: '代理不存在' });
    const cfg = pool.getConfig();
    const result = await probeHttps(rec, Math.max(cfg.timeoutMs, 8000));
    res.json({ result });
  });

  /* ------------------------- 删除 / 清空 ------------------------- */

  app.delete('/api/proxy/pool/:id', (req: Request, res: Response) => {
    const id = decodeURIComponent(req.params.id);
    const ok = pool.remove(id);
    if (!ok) return res.status(404).json({ error: '代理不存在' });
    engineEvents.emit('event', { type: 'pool', stats: pool.stats() });
    res.json({ success: true });
  });

  app.delete('/api/proxy/pool', (_req: Request, res: Response) => {
    pool.clear();
    engineEvents.emit('event', { type: 'pool', stats: pool.stats() });
    engineEvents.emit('event', { type: 'cleared' });
    res.json({ success: true });
  });

  /* ------------------------- 导出 / Clash ------------------------- */

  app.post('/api/proxy/export', (_req: Request, res: Response) => {
    const result = exportNow();
    res.json({
      ...result,
      records: dedupeForClash(pool.exportable()).length,
      stats: pool.stats(),
    });
  });

  const clashRecords = () => dedupeForClash(pool.exportable());

  app.get('/api/proxy/clash', (_req: Request, res: Response) => {
    const records = clashRecords();
    res.json({
      count: records.length,
      yaml: buildClashConfig(records),
      records,
    });
  });

  app.get('/api/proxy/clash.yaml', (_req: Request, res: Response) => {
    const records = clashRecords();
    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="free-proxy-hunter.yaml"');
    res.send(buildClashConfig(records));
  });

  /** Clash Verge 远程订阅地址：只含节点，供 proxy-providers 引用 */
  app.get('/api/proxy/clash-provider.yaml', (_req: Request, res: Response) => {
    const records = clashRecords();
    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.send(buildProviderYaml(records));
  });

  /** 供前端复制粘贴的引用片段 */
  app.get('/api/proxy/clash-snippet', (req: Request, res: Response) => {
    const host = req.get('host') ?? `127.0.0.1:${process.env.PORT || 3000}`;
    // 协议必须跟着请求走，不能写死 http://。
    // 部署在 Nginx / Cloudflare Tunnel 之后对外是 HTTPS，写死 http 会让页面复制出去的
    // 订阅地址在 Clash 里因「明文混用 / 端口不对」而拉不到配置。
    // 这依赖 index.ts 里开启的 trust proxy，否则 req.protocol 恒为 http。
    const proto = req.protocol || 'http';
    const selfUrl = `${proto}://${host}/api/proxy/clash-provider.yaml`;
    res.json({
      selfUrl,
      snippet: buildProviderSnippet(selfUrl),
      configUrl: `${proto}://${host}/api/proxy/clash.yaml`,
      // 跟随 DATA_DIR：容器里数据目录可能是 /app/data 之外的挂载点，
      // 写死 'data/...' 会让用户去一个不存在的路径找文件。
      localFile: CLASH_FILE,
    });
  });

  /* ------------------------- SSE 事件流 ------------------------- */

  app.get('/api/proxy/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (payload: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* 客户端已断开 */
      }
    };

    send({ type: 'hello', progress: snapshotProgress(), stats: pool.stats(), targets: targetStatus() });
    send({ type: 'pool', records: pool.list({ limit: 500 }), stats: pool.stats() });

    const onEvent = (payload: Record<string, unknown>) => send(payload);
    engineEvents.on('event', onEvent);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 20000);

    const cleanup = () => {
      clearInterval(heartbeat);
      engineEvents.off('event', onEvent);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
  });
}
