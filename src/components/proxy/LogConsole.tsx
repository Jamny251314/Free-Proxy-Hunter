import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Progress } from 'tdesign-react';
import { TaskProgress } from '../../proxy-types';

interface Props {
  progress: TaskProgress | null;
  connected: boolean;
}

const LEVEL_COLOR: Record<string, string> = {
  info: 'var(--td-text-color-secondary)',
  success: '#00a870',
  warn: '#e37318',
  error: '#d54941',
};

const PHASE_LABEL: Record<string, string> = {
  fetch: '采集代理源',
  test: '并发测速验证',
  sync: '一键同步',
  export: '生成配置',
  idle: '空闲',
};

export function LogConsole({ progress, connected }: Props) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const logs = progress?.logs ?? [];
  const running = Boolean(progress?.running);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs.length, open]);

  const percent =
    running && progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : running
        ? 30
        : 0;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--td-bg-color-container)', borderColor: 'var(--td-component-border)' }}
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            backgroundColor: running ? 'var(--td-brand-color)' : connected ? '#00a870' : '#d54941',
            boxShadow: running ? '0 0 0 4px var(--td-brand-color-light)' : undefined,
          }}
        />
        <span className="text-sm shrink-0" style={{ color: 'var(--td-text-color-primary)' }}>
          {running ? PHASE_LABEL[progress?.phase ?? 'idle'] ?? '执行中' : '引擎空闲'}
        </span>
        <span className="text-xs truncate flex-1" style={{ color: 'var(--td-text-color-secondary)' }}>
          {progress?.message ?? '等待指令'}
        </span>
        {running && progress && progress.total > 0 && (
          <span className="text-xs tabular-nums shrink-0" style={{ color: 'var(--td-text-color-secondary)' }}>
            {progress.current} / {progress.total}
          </span>
        )}
        <span className="text-[11px] shrink-0" style={{ color: connected ? '#00a870' : '#d54941' }}>
          {connected ? '实时通道已连接' : '实时通道重连中…'}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 flex items-center gap-1 text-xs"
          style={{ color: 'var(--td-text-color-secondary)' }}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? '收起' : '展开'}
        </button>
      </div>

      {running && (
        <div className="px-4 pb-2">
          <Progress theme="line" percentage={percent} size="small" label={false} />
        </div>
      )}

      {open && (
        <div
          ref={bodyRef}
          className="px-4 pb-3 overflow-y-auto font-mono text-[11.5px] leading-relaxed"
          style={{
            maxHeight: 170,
            borderTop: '1px solid var(--td-component-border)',
            backgroundColor: 'var(--td-bg-color-page)',
          }}
        >
          {logs.length === 0 ? (
            <div className="py-3" style={{ color: 'var(--td-text-color-placeholder)' }}>
              暂无日志。点击「一键同步」开始采集与测速。
            </div>
          ) : (
            logs.map((l, i) => (
              <div key={`${l.at}-${i}`} className="py-0.5 flex gap-2">
                <span style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {new Date(l.at).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
                <span style={{ color: LEVEL_COLOR[l.level] ?? 'inherit' }} className="break-all">
                  {l.text}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
