import { Button, Table, Tag, Tooltip } from 'tdesign-react';
import type { PrimaryTableCol } from 'tdesign-react';
import { SourceInfo } from '../../proxy-types';

interface Props {
  sources: SourceInfo[];
  loading: boolean;
  onFetchSource: (key: string) => Promise<unknown>;
  onRefresh: () => void;
}

const KIND_LABEL: Record<string, string> = {
  html: 'HTML 分页',
  text: '纯文本/API',
  json: 'JSON API',
};

export function SourcePanel({ sources, loading, onFetchSource, onRefresh }: Props) {
  // 停用的源排在最后，可用源优先展示
  const ordered = [...sources].sort((a, b) => Number(a.disabled) - Number(b.disabled));
  const disabledCount = sources.filter((s) => s.disabled).length;

  const columns: PrimaryTableCol<SourceInfo>[] = [
    {
      colKey: 'name',
      title: '代理源',
      width: 230,
      cell: ({ row }) => (
        <div className="leading-tight">
          <div className="flex items-center gap-1">
            <a
              href={row.homepage}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] hover:underline"
              style={{ color: row.disabled ? 'var(--td-text-color-placeholder)' : 'var(--td-brand-color)' }}
            >
              {row.name}
            </a>
            {row.disabled && (
              <Tag size="small" theme="default" variant="light">
                已停用
              </Tag>
            )}
          </div>
          <div className="text-[11px] font-mono" style={{ color: 'var(--td-text-color-placeholder)' }}>
            {row.key}
          </div>
        </div>
      ),
    },
    {
      colKey: 'protocol',
      title: '协议',
      width: 86,
      cell: ({ row }) => (
        <Tag size="small" variant="outline">
          {row.protocol.toUpperCase()}
        </Tag>
      ),
    },
    {
      colKey: 'kind',
      title: '采集方式',
      width: 130,
      cell: ({ row }) => (
        <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          {row.mirrors ? '镜像竞速' : KIND_LABEL[row.kind] ?? row.kind}
          {!row.mirrors && row.pages > 1 ? ` · ${row.pages} 页` : ''}
        </span>
      ),
    },
    {
      colKey: 'report',
      title: '上次采集',
      width: 190,
      cell: ({ row }) => {
        if (!row.report) {
          return (
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              尚未采集
            </span>
          );
        }
        if (!row.report.ok) {
          return (
            <Tooltip content={row.report.error ?? '未知错误'}>
              <Tag size="small" theme="danger" variant="light">
                失败
              </Tag>
            </Tooltip>
          );
        }
        return (
          <span className="text-xs tabular-nums" style={{ color: 'var(--td-text-color-secondary)' }}>
            发现 <b style={{ color: 'var(--td-text-color-primary)' }}>{row.report.found}</b> · 新增{' '}
            <b style={{ color: '#00a870' }}>{row.report.added}</b> · {row.report.ms}ms
          </span>
        );
      },
    },
    {
      colKey: 'note',
      title: '备注',
      ellipsis: true,
      cell: ({ row }) => (
        <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          {row.note ?? '—'}
        </span>
      ),
    },
    {
      colKey: 'op',
      title: '操作',
      width: 96,
      fixed: 'right',
      cell: ({ row }) => (
        <Tooltip content={row.disabled ? '该源已停用，但仍可单独采集以确认是否恢复可用' : '只刷新这一个源'}>
          <Button size="small" variant="outline" onClick={() => onFetchSource(row.key)}>
            单独采集
          </Button>
        </Tooltip>
      ),
    },
  ];

  return (
    <div
      className="rounded-xl border overflow-hidden flex flex-col"
      style={{ backgroundColor: 'var(--td-bg-color-container)', borderColor: 'var(--td-component-border)' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--td-component-border)' }}>
        <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
          已内置 {sources.length} 个免费代理源（国内站点 + 公开 API + GitHub 高频维护仓库），
          其中 {sources.length - disabledCount} 个参与默认采集
          {disabledCount > 0 ? `，${disabledCount} 个实测失效已停用` : ''}
        </span>
        <Button size="small" variant="outline" onClick={onRefresh}>
          刷新状态
        </Button>
      </div>
      <Table
        data={ordered}
        columns={columns}
        rowKey="key"
        size="small"
        hover
        loading={loading}
        tableLayout="fixed"
        pagination={{ defaultPageSize: 12, showJumper: true }}
      />
    </div>
  );
}
