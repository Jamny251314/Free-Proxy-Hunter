import { useCallback, useState } from 'react';
import { Button, Dialog, Loading, MessagePlugin, Tabs, Tag } from 'tdesign-react';
import { CloudDownload, Gauge, PlayCircle, RefreshCw, Trash2, Zap } from 'lucide-react';

import { useProxyPool } from '../hooks/useProxyPool';
import { ProxyStatCards } from '../components/proxy/ProxyStatCards';
import { ProxyTable } from '../components/proxy/ProxyTable';
import { ClashPanel } from '../components/proxy/ClashPanel';
import { ConfigPanel } from '../components/proxy/ConfigPanel';
import { SourcePanel } from '../components/proxy/SourcePanel';
import { LogConsole } from '../components/proxy/LogConsole';

type PoolApi = ReturnType<typeof useProxyPool>;

export function ProxyPage({ pool }: { pool: PoolApi }) {
  const [tab, setTab] = useState('pool');
  const [filters, setFilters] = useState<{ status?: string; protocol?: string; minScore?: number | '' }>({});
  const [clearing, setClearing] = useState(false);

  const handleFiltersChange = useCallback(
    (f: { status?: string; protocol?: string; minScore?: number | '' }) => {
      const next = { ...filters, ...f };
      setFilters(next);
      void pool.refresh(next);
    },
    [filters, pool],
  );

  const guard = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        MessagePlugin.success(`${label}完成`);
      } catch (e) {
        MessagePlugin.error((e as Error).message || `${label}失败`);
      }
    },
    [],
  );

  const busy = pool.busy;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto p-5 flex flex-col gap-4">
        {/* 顶部标题与主操作 */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
                免费代理池
              </h2>
              {busy && (
                <Tag size="small" theme="primary" variant="light">
                  {pool.task === 'fetch' ? '采集中' : pool.task === 'test' ? '测速中' : '执行中'}
                </Tag>
              )}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              全网抓取免费 IP 代理 → 实时测速验证 → 运行时持续同步源站免费库 → 整合去重 → 一键接入 Clash Verge
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              theme="primary"
              icon={<Zap size={16} />}
              loading={busy}
              onClick={() => guard('一键同步', pool.runSync)}
            >
              一键同步
            </Button>
            <Button
              variant="outline"
              icon={<CloudDownload size={16} />}
              loading={busy}
              onClick={() => guard('抓取更新', () => pool.runFetch())}
            >
              仅抓取更新
            </Button>
            <Button
              variant="outline"
              icon={<PlayCircle size={16} />}
              loading={busy}
              onClick={() => guard('测速验证', () => pool.runTest('unknown'))}
            >
              测速验证
            </Button>
            <Button
              variant="outline"
              icon={<Gauge size={16} />}
              loading={busy}
              disabled={pool.stats.total === 0}
              onClick={() => guard('整池复验', () => pool.runTest('all'))}
            >
              整池复验
            </Button>
            <Button
              variant="outline"
              icon={<RefreshCw size={16} />}
              onClick={() => guard('导出 Clash 配置', pool.exportNow)}
            >
              重新导出
            </Button>
            <Button
              variant="text"
              icon={<Trash2 size={16} />}
              disabled={busy || pool.stats.total === 0}
              onClick={() => setClearing(true)}
            >
              清空池
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        <ProxyStatCards stats={pool.stats} loading={pool.loading} />

        {/* 进度与日志 */}
        <LogConsole progress={pool.progress} connected={pool.connected} />

        {/* 引擎设置 */}
        <ConfigPanel config={pool.config} targets={pool.targets} onSave={pool.saveConfig} />

        {/* Tabs */}
        <Tabs value={tab} onChange={(v) => setTab(v as string)}>
          <Tabs.TabPanel value="pool" label="代理池" />
          <Tabs.TabPanel value="clash" label="接入 Clash Verge" />
          <Tabs.TabPanel value="sources" label={`代理源 (${pool.sources.length})`} />
        </Tabs>

        {tab === 'pool' && (
          <ProxyTable
            records={pool.records}
            loading={pool.loading}
            onRefresh={() => guard('刷新', pool.refresh)}
            onTestOne={pool.testOne}
            onRemove={pool.removeOne}
            onFiltersChange={handleFiltersChange}
          />
        )}

        {tab === 'clash' && <ClashPanel aliveCount={pool.stats.alive} />}

        {tab === 'sources' && (
          <SourcePanel
            sources={pool.sources}
            loading={pool.loading}
            onFetchSource={(key) => guard(`采集 ${key}`, () => pool.runFetch([key]))}
            onRefresh={() => guard('刷新', pool.refreshSources)}
          />
        )}

        {/* 首次加载遮罩 */}
        {pool.loading && pool.records.length === 0 && (
          <div className="flex justify-center py-6">
            <Loading size="small" text="正在读取代理池…" />
          </div>
        )}
      </div>

      <Dialog
        visible={clearing}
        header="确认清空代理池？"
        onClose={() => setClearing(false)}
        onConfirm={async () => {
          setClearing(false);
          await guard('清空', pool.clearAll);
        }}
        confirmBtn={{ theme: 'danger', content: '清空' }}
        cancelBtn="取消"
      >
        将删除本地保存的全部 {pool.stats.total} 条代理记录与采集来源信息，此操作不可撤销。
        代理源清单与引擎设置会保留。
      </Dialog>
    </div>
  );
}

export default ProxyPage;
