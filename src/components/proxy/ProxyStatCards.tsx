import { PoolStats } from '../../proxy-types';

interface Props {
  stats: PoolStats;
  loading: boolean;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function latencyTone(v: number | null): string {
  if (v == null) return 'var(--td-text-color-secondary)';
  if (v <= 500) return '#00a870';
  if (v <= 1500) return '#e37318';
  return '#d54941';
}

export function ProxyStatCards({ stats, loading }: Props) {
  const aliveRate = stats.total > 0 ? Math.round((stats.alive / stats.total) * 100) : 0;

  const cards: Array<{ label: string; value: string; sub?: string; color?: string }> = [
    {
      label: '池内节点',
      value: String(stats.total),
      sub: `${Object.entries(stats.byProtocol)
        .map(([k, v]) => `${k.toUpperCase()} ${v}`)
        .join(' · ') || '暂无数据'}`,
    },
    {
      label: '可用节点',
      value: String(stats.alive),
      sub: `可用率 ${aliveRate}%`,
      color: '#00a870',
    },
    {
      label: '平均延迟',
      value: stats.avgLatency != null ? `${stats.avgLatency} ms` : '—',
      sub: '仅统计可用节点',
      color: latencyTone(stats.avgLatency),
    },
    {
      label: '最快节点',
      value: stats.bestLatency != null ? `${stats.bestLatency} ms` : '—',
      sub: '实测最优响应',
      color: latencyTone(stats.bestLatency),
    },
    {
      label: '失效 / 待测',
      value: `${stats.dead} / ${stats.unknown}`,
      sub: '连续失败将被淘汰',
      color: stats.dead > 0 ? '#d54941' : undefined,
    },
    {
      label: '最近同步',
      value: fmtTime(stats.lastSyncAt),
      sub: `抓取 ${fmtTime(stats.lastFetchAt)}`,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl px-4 py-3 border transition-opacity"
          style={{
            backgroundColor: 'var(--td-bg-color-container)',
            borderColor: 'var(--td-component-border)',
            opacity: loading ? 0.6 : 1,
          }}
        >
          <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            {c.label}
          </div>
          <div
            className="text-xl font-semibold leading-tight tabular-nums"
            style={{ color: c.color ?? 'var(--td-text-color-primary)' }}
          >
            {c.value}
          </div>
          {c.sub && (
            <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--td-text-color-placeholder)' }}>
              {c.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
