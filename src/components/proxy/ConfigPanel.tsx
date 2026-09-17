import { useEffect, useState } from 'react';
import { Button, InputNumber, MessagePlugin, Switch, Tooltip } from 'tdesign-react';
import { HelpCircle, Save } from 'lucide-react';
import { EngineConfig, TargetInfo } from '../../proxy-types';

interface Props {
  config: EngineConfig | null;
  targets: TargetInfo;
  onSave: (patch: Partial<EngineConfig>) => Promise<EngineConfig>;
}

interface FieldDef {
  key: keyof EngineConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
  tip: string;
}

const NUM_FIELDS: FieldDef[] = [
  { key: 'intervalMinutes', label: '自动更新间隔', min: 1, max: 1440, step: 5, suffix: '分钟', tip: '运行时每隔多久自动执行一次「采集 → 测速 → 整合」' },
  { key: 'concurrency', label: '测速并发', min: 1, max: 500, step: 10, suffix: '条', tip: '同时探测的代理数量。越高越快，但对本机网络压力越大，建议 80–200' },
  { key: 'timeoutMs', label: '单次超时', min: 1000, max: 30000, step: 500, suffix: 'ms', tip: '单条代理连接与响应的最长等待时间，超过即判定失败' },
  { key: 'maxConsecutiveFail', label: '淘汰阈值', min: 1, max: 20, step: 1, suffix: '次', tip: '连续失败达到该次数后标记为失效，2 倍后从池中移除' },
  { key: 'minScore', label: '导出最低评分', min: 0, max: 100, step: 5, suffix: '分', tip: '导出 Clash 配置时剔除低于该评分的节点，默认 20' },
  { key: 'exportLimit', label: '导出节点上限', min: 1, max: 5000, step: 50, suffix: '个', tip: 'Clash 配置中最多包含多少个节点，按评分从高到低取' },
];

export function ConfigPanel({ config, targets, onSave }: Props) {
  const [draft, setDraft] = useState<EngineConfig | null>(config);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  if (!draft) return null;

  const patch = (key: keyof EngineConfig, value: number | boolean) => {
    setDraft({ ...draft, [key]: value } as EngineConfig);
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      MessagePlugin.success('配置已保存并生效');
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{ backgroundColor: 'var(--td-bg-color-container)', borderColor: 'var(--td-component-border)' }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
          引擎设置
        </span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
              运行时自动更新
            </span>
            <Switch
              size="small"
              value={draft.autoSync}
              onChange={(v) => patch('autoSync', Boolean(v))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
              解析地区
            </span>
            <Switch size="small" value={draft.detectGeo} onChange={(v) => patch('detectGeo', Boolean(v))} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
              判定匿名度
            </span>
            <Switch
              size="small"
              value={draft.detectAnonymity}
              onChange={(v) => patch('detectAnonymity', Boolean(v))}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {NUM_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
              {f.label}
              <Tooltip content={f.tip}>
                <HelpCircle size={12} style={{ cursor: "help" }} />
              </Tooltip>
            </div>
            <InputNumber
              size="small"
              theme="normal"
              value={draft[f.key] as number}
              min={f.min}
              max={f.max}
              step={f.step}
              suffix={f.suffix}
              onChange={(v) => patch(f.key, Number(v ?? f.min))}
            />
          </div>
        ))}
      </div>

      <div
        className="text-[11px] leading-relaxed rounded-lg px-3 py-2"
        style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
      >
        测速回显目标：{targets.info ?? '未就绪'} ｜ 本机出口 IP：{targets.localIp ?? '未知'}
        <br />
        {/* ping 是静态列表里的第一个纯连通性目标，未必在本机可达（如 gstatic 境内常年打不通）。
            要判断「回显目标是否可达」得看 reachable（直连实测结果）。 */}
        实际尝试顺序：共 {targets.attempts?.length ?? '—'} 个目标，命中第一个即止
        {targets.reachable ? ` ｜ 直连可达：${targets.reachable.info ?? '无信息目标'}` : ''}
        <br />
        提示：关闭「运行时自动更新」后仍可在上方手动点击「一键同步」。
      </div>

      {dirty && (
        <div className="flex justify-end">
          <Button size="small" theme="primary" icon={<Save size={14} />} loading={saving} onClick={submit}>
            保存配置
          </Button>
        </div>
      )}
    </div>
  );
}
