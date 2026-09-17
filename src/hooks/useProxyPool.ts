/**
 * 代理池数据 Hook
 * ------------------------------------------------------------
 * - 首次进入时拉取全量快照
 * - 通过 SSE 订阅引擎事件，实时更新进度 / 单条测速结果 / 池统计
 * - 暴露所有操作动作给页面
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EngineConfig,
  PoolStats,
  ProxyRecord,
  SourceInfo,
  TargetInfo,
  TaskProgress,
} from '../proxy-types';

export interface ProxyFilters {
  status: string;
  protocol: string;
  maxLatency: number | '';
  keyword: string;
  minScore: number | '';
}

const EMPTY_STATS: PoolStats = {
  total: 0,
  alive: 0,
  dead: 0,
  unknown: 0,
  byProtocol: {},
  avgLatency: null,
  bestLatency: null,
  lastFetchAt: null,
  lastTestAt: null,
  lastSyncAt: null,
};

interface ProbePayload {
  id: string;
  ok: boolean;
  latency?: number;
  status?: ProxyRecord['status'];
  score?: number;
  country?: string;
  city?: string;
  anonymity?: ProxyRecord['anonymity'];
  reason?: string;
}

/** 把一条测速结果合并进本地记录（避免为每条结果重拉全量） */
function applyProbe(prev: ProxyRecord[], payload: ProbePayload): ProxyRecord[] {
  const idx = prev.findIndex((r) => r.id === payload.id);
  if (idx < 0) return prev;
  const next = [...prev];
  const cur = next[idx];
  const latency = payload.ok && typeof payload.latency === 'number' ? payload.latency : null;
  const prevAvg = cur.latencyAvg;
  next[idx] = {
    ...cur,
    status: payload.status ?? cur.status,
    score: typeof payload.score === 'number' ? payload.score : cur.score,
    latency,
    latencyAvg:
      latency == null
        ? prevAvg
        : prevAvg == null
          ? latency
          : Math.round(prevAvg * 0.6 + latency * 0.4),
    country: payload.country ?? cur.country,
    city: payload.city ?? cur.city,
    anonymity: payload.anonymity ?? cur.anonymity,
    lastError: payload.ok ? undefined : payload.reason,
    checks: cur.checks + 1,
    success: cur.success + (payload.ok ? 1 : 0),
    fail: cur.fail + (payload.ok ? 0 : 1),
    lastChecked: new Date().toISOString(),
  };
  return next;
}

export function useProxyPool() {
  const [records, setRecords] = useState<ProxyRecord[]>([]);
  const [stats, setStats] = useState<PoolStats>(EMPTY_STATS);
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [targets, setTargets] = useState<TargetInfo>({ info: null, ping: null, localIp: null });
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<string | null>(null);

  const filtersRef = useRef<ProxyFilters>({
    status: 'all',
    protocol: 'all',
    maxLatency: '',
    keyword: '',
    minScore: '',
  });

  /* ---------------- 拉取快照 ---------------- */

  const refresh = useCallback(async (filters?: Partial<ProxyFilters>) => {
    const f = { ...filtersRef.current, ...(filters ?? {}) };
    filtersRef.current = f;
    const params = new URLSearchParams();
    if (f.status && f.status !== 'all') params.set('status', f.status);
    if (f.protocol && f.protocol !== 'all') params.set('protocol', f.protocol);
    if (f.maxLatency !== '' && f.maxLatency !== undefined) params.set('maxLatency', String(f.maxLatency));
    if (f.minScore !== '' && f.minScore !== undefined) params.set('minScore', String(f.minScore));
    if (f.keyword) params.set('keyword', f.keyword);
    params.set('limit', '2000');

    try {
      const res = await fetch(`/api/proxy/pool?${params.toString()}`);
      const data = await res.json();
      setRecords(data.records ?? []);
      setStats(data.stats ?? EMPTY_STATS);
      setConfig(data.config ?? null);
      setProgress(data.progress ?? null);
      setBusy(Boolean(data.busy));
      setTask(data.task ?? null);
      setTargets(data.targets ?? { info: null, ping: null, localIp: null });
    } catch (e) {
      console.error('[ProxyPool] 拉取失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSources = useCallback(async () => {
    try {
      const res = await fetch('/api/proxy/sources');
      const data = await res.json();
      setSources(data.sources ?? []);
    } catch (e) {
      console.error('[ProxyPool] 拉取源清单失败', e);
    }
  }, []);

  /* ---------------- SSE 订阅 ---------------- */

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source = new EventSource('/api/proxy/stream');

      source.onopen = () => setConnected(true);

      source.onmessage = (ev) => {
        let payload: any;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (payload.type) {
          case 'hello':
            setProgress(payload.progress ?? null);
            setStats(payload.stats ?? EMPTY_STATS);
            if (payload.targets) setTargets(payload.targets);
            break;
          case 'pool':
            if (Array.isArray(payload.records)) setRecords(payload.records);
            if (payload.stats) setStats(payload.stats);
            break;
          case 'progress':
            if (payload.progress) {
              setProgress(payload.progress);
              setBusy(Boolean(payload.progress.running));
            }
            break;
          case 'probe':
            setRecords((prev) => applyProbe(prev, payload));
            break;
          case 'probe-batch':
            if (Array.isArray(payload.items)) {
              setRecords((prev) => {
                let next = prev;
                for (const item of payload.items) {
                  next = applyProbe(next, item);
                }
                return next;
              });
            }
            break;
          case 'sync-done':
            void refresh();
            break;
          case 'cleared':
            setRecords([]);
            break;
          default:
            break;
        }
      };

      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [refresh]);

  useEffect(() => {
    void refresh();
    void refreshSources();
  }, [refresh, refreshSources]);

  /* ---------------- 动作 ---------------- */

  const post = useCallback(
    async <T,>(url: string, body?: unknown): Promise<T> => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `请求失败 (${res.status})`);
      return data as T;
    },
    [],
  );

  const runFetch = useCallback(
    async (sourceKeys?: string[]) => {
      setBusy(true);
      try {
        return await post<{ totalFound: number; totalAdded: number }>('/api/proxy/fetch', {
          sources: sourceKeys,
        });
      } finally {
        setBusy(false);
        await refresh();
        await refreshSources();
      }
    },
    [post, refresh, refreshSources],
  );

  const runTest = useCallback(
    async (scope: 'unknown' | 'all' | 'alive' | 'stale' = 'unknown') => {
      setBusy(true);
      try {
        return await post<{ tested: number; alive: number; dead: number }>('/api/proxy/test', { scope });
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [post, refresh],
  );

  const runSync = useCallback(async () => {
    setBusy(true);
    try {
      return await post<{ tested: number; alive: number; exported: number }>('/api/proxy/sync');
    } finally {
      setBusy(false);
      await refresh();
      await refreshSources();
    }
  }, [post, refresh, refreshSources]);

  const exportNow = useCallback(async () => {
    const res = await post<{ count: number; path: string }>('/api/proxy/export');
    await refresh();
    return res;
  }, [post, refresh]);

  const testOne = useCallback(
    async (id: string) => post<{ record: ProxyRecord }>('/api/proxy/test-one', { id }),
    [post],
  );

  const removeOne = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/proxy/pool/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      setRecords((prev) => prev.filter((r) => r.id !== id));
    },
    [],
  );

  const clearAll = useCallback(async () => {
    const res = await fetch('/api/proxy/pool', { method: 'DELETE' });
    if (!res.ok) throw new Error('清空失败');
    setRecords([]);
    await refresh();
  }, [refresh]);

  const saveConfig = useCallback(
    async (patch: Partial<EngineConfig>) => {
      const res = await fetch('/api/proxy/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '保存失败');
      setConfig(data.config);
      return data.config as EngineConfig;
    },
    [],
  );

  const clashLinks = useMemo(
    () => ({
      provider: '/api/proxy/clash-provider.yaml',
      config: '/api/proxy/clash.yaml',
      viewer: '/api/proxy/clash',
      snippet: '/api/proxy/clash-snippet',
    }),
    [],
  );

  return {
    records,
    stats,
    config,
    progress,
    sources,
    targets,
    connected,
    loading,
    busy,
    task,
    clashLinks,
    refresh,
    refreshSources,
    runFetch,
    runTest,
    runSync,
    exportNow,
    testOne,
    removeOne,
    clearAll,
    saveConfig,
  };
}
