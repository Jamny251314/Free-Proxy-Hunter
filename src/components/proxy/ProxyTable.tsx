import { useState } from 'react';
import { Button, Input, Select, Table, Tag, Tooltip, MessagePlugin } from 'tdesign-react';
import { RefreshCw, Trash2, Search } from 'lucide-react';
import type { PrimaryTableCol } from 'tdesign-react';
import { ProxyRecord } from '../../proxy-types';

interface Props {
  records: ProxyRecord[];
  loading: boolean;
  onRefresh: () => void;
  onTestOne: (id: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<void>;
  onFiltersChange: (f: { status?: string; protocol?: string; minScore?: number | '' }) => void;
}

function latencyColor(v: number | null): string {
  if (v == null) return 'var(--td-text-color-placeholder)';
  if (v <= 500) return '#00a870';
  if (v <= 1500) return '#e37318';
  return '#d54941';
}

function scoreTagTheme(score: number): 'success' | 'warning' | 'danger' | 'default' {
  if (score >= 75) return 'success';
  if (score >= 50) return 'warning';
  if (score > 0) return 'danger';
  return 'default';
}

const ANONYMITY_LABEL: Record<string, string> = {
  elite: '高匿',
  anonymous: '匿名',
  transparent: '透明',
  unknown: '未知',
};

const PROTOCOL_LABEL: Record<string, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  socks4: 'SOCKS4',
  socks5: 'SOCKS5',
};

export function ProxyTable({ records, loading, onRefresh, onTestOne, onRemove, onFiltersChange }: Props) {
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [keyword, setKeyword] = useState('');

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      MessagePlugin.success(`已复制 ${text}`);
    } catch {
      MessagePlugin.warning('浏览器拒绝了剪贴板访问，请手动复制');
    }
  };

  const handleTest = async (id: string) => {
    setTesting((p) => ({ ...p, [id]: true }));
    try {
      await onTestOne(id);
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      setTesting((p) => ({ ...p, [id]: false }));
    }
  };

  const filtered = keyword
    ? records.filter(
        (r) =>
          r.host.includes(keyword) ||
          String(r.port).includes(keyword) ||
          (r.country ?? '').includes(keyword) ||
          (r.city ?? '').includes(keyword) ||
          (r.isp ?? '').toLowerCase().includes(keyword.toLowerCase()),
      )
    : records;

  const columns: PrimaryTableCol<ProxyRecord>[] = [
    {
      colKey: 'endpoint',
      title: '节点地址',
      width: 190,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px]">
            {row.host}:{row.port}
          </span>
          <Tooltip content="复制节点">
            <Button
              variant="text"
              size="small"
              onClick={() => copy(`${row.host}:${row.port}`)}
              style={{ padding: 0, height: 18, minWidth: 18 }}
            >
              复制
            </Button>
          </Tooltip>
        </div>
      ),
    },
    {
      colKey: 'protocol',
      title: '协议',
      width: 88,
      cell: ({ row }) => (
        <Tag size="small" variant="outline">
          {PROTOCOL_LABEL[row.protocol] ?? row.protocol}
        </Tag>
      ),
    },
    {
      colKey: 'status',
      title: '状态',
      width: 110,
      cell: ({ row }) => {
        const map: Record<string, { theme: 'success' | 'danger' | 'default'; text: string }> = {
          alive: { theme: 'success', text: '可用' },
          dead: { theme: 'danger', text: '失效' },
          unknown: { theme: 'default', text: '待测速' },
        };
        const cfg = map[row.status] ?? map.unknown;
        return (
          <Tooltip content={row.lastError ?? `已检测 ${row.checks} 次`}>
            <Tag size="small" theme={cfg.theme} variant="light">
              {cfg.text}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      colKey: 'latency',
      title: '延迟',
      width: 92,
      sorter: (a: ProxyRecord, b: ProxyRecord) => (a.latencyAvg ?? 1e9) - (b.latencyAvg ?? 1e9),
      cell: ({ row }) => {
        const v = row.latencyAvg ?? row.latency;
        return (
          <span className="tabular-nums font-medium" style={{ color: latencyColor(v) }}>
            {v != null ? `${v} ms` : '—'}
          </span>
        );
      },
    },
    {
      colKey: 'jitter',
      title: '抖动',
      width: 80,
      cell: ({ row }) => (
        <span className="tabular-nums" style={{ color: 'var(--td-text-color-secondary)' }}>
          {row.jitter != null ? `${row.jitter} ms` : '—'}
        </span>
      ),
    },
    {
      colKey: 'geo',
      title: '出口地区 / ISP',
      width: 200,
      cell: ({ row }) => (
        <div className="text-[13px] leading-tight">
          <div>
            {[row.country, row.region, row.city].filter(Boolean).join(' · ') || '—'}
          </div>
          <div className="truncate" style={{ color: 'var(--td-text-color-secondary)', fontSize: 11 }}>
            {row.isp || row.exitIp || ''}
          </div>
        </div>
      ),
    },
    {
      colKey: 'anonymity',
      title: '匿名度',
      width: 82,
      cell: ({ row }) => (
        <Tag size="small" variant="light" theme={row.anonymity === 'elite' ? 'success' : row.anonymity === 'transparent' ? 'warning' : 'default'}>
          {ANONYMITY_LABEL[row.anonymity] ?? '未知'}
        </Tag>
      ),
    },
    {
      colKey: 'score',
      title: '评分',
      width: 78,
      sorter: (a: ProxyRecord, b: ProxyRecord) => b.score - a.score,
      cell: ({ row }) => (
        <Tag size="small" theme={scoreTagTheme(row.score)} variant="light">
          {row.score}
        </Tag>
      ),
    },
    {
      colKey: 'successRate',
      title: '成功率',
      width: 86,
      cell: ({ row }) => {
        const total = row.success + row.fail;
        const rate = total === 0 ? null : Math.round((row.success / total) * 100);
        return (
          <span className="tabular-nums" style={{ color: 'var(--td-text-color-secondary)' }}>
            {rate == null ? '—' : `${rate}% (${total})`}
          </span>
        );
      },
    },
    {
      colKey: 'sources',
      title: '来源',
      width: 110,
      cell: ({ row }) => (
        <Tooltip content={row.sources.join('、')}>
          <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
            {row.sources.length} 个源
          </span>
        </Tooltip>
      ),
    },
    {
      colKey: 'op',
      title: '操作',
      width: 130,
      fixed: 'right',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            size="small"
            variant="outline"
            loading={Boolean(testing[row.id])}
            onClick={() => handleTest(row.id)}
          >
            重测
          </Button>
          <Tooltip content="从池中删除">
            <Button
              size="small"
              variant="text"
              icon={<Trash2 size={14} />}
              onClick={async () => {
                await onRemove(row.id);
                MessagePlugin.success('已删除');
              }}
            />
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <div
      className="rounded-xl border overflow-hidden flex flex-col"
      style={{ backgroundColor: 'var(--td-bg-color-container)', borderColor: 'var(--td-component-border)' }}
    >
      {/* 过滤条 */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--td-component-border)' }}>
        <Input
          value={keyword}
          onChange={setKeyword}
          placeholder="搜索 IP / 端口 / 地区 / ISP"
          prefixIcon={<Search size={15} />}
          clearable
          style={{ width: 220 }}
          size="small"
        />
        <Select
          size="small"
          value="all"
          style={{ width: 120 }}
          onChange={(v) => onFiltersChange({ status: v as string })}
          options={[
            { label: '全部状态', value: 'all' },
            { label: '仅可用', value: 'alive' },
            { label: '仅失效', value: 'dead' },
            { label: '待测速', value: 'unknown' },
          ]}
        />
        <Select
          size="small"
          value="all"
          style={{ width: 120 }}
          onChange={(v) => onFiltersChange({ protocol: v as string })}
          options={[
            { label: '全部协议', value: 'all' },
            { label: 'HTTP', value: 'http' },
            { label: 'HTTPS', value: 'https' },
            { label: 'SOCKS4', value: 'socks4' },
            { label: 'SOCKS5', value: 'socks5' },
          ]}
        />
        <Select
          size="small"
          value=""
          style={{ width: 130 }}
          onChange={(v) => onFiltersChange({ minScore: v === '' ? '' : Number(v) })}
          options={[
            { label: '不限评分', value: '' },
            { label: '评分 ≥ 50', value: 50 },
            { label: '评分 ≥ 70', value: 70 },
            { label: '评分 ≥ 85', value: 85 },
          ]}
        />
        <div className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          当前 {filtered.length} 条
        </span>
        <Button size="small" variant="outline" icon={<RefreshCw size={14} />} onClick={onRefresh}>
          刷新
        </Button>
      </div>

      <Table
        data={filtered}
        columns={columns}
        rowKey="id"
        size="small"
        hover
        stripe
        loading={loading}
        tableLayout="fixed"
        pagination={{
          defaultPageSize: 15,
          defaultCurrent: 1,
          showJumper: true,
          pageSizeOptions: [15, 30, 50, 100],
        }}
        empty="代理池为空，先点上方「一键同步」抓取一轮吧"
        maxHeight={560}
      />
    </div>
  );
}
