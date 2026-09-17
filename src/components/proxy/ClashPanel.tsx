import { useEffect, useState } from 'react';
import { Button, MessagePlugin, Tag } from 'tdesign-react';
import { Copy, Download, Link2 } from 'lucide-react';
import { apiUrl } from '../../api';

interface Props {
  aliveCount: number;
}

interface SnippetInfo {
  selfUrl: string;
  snippet: string;
  configUrl: string;
  localFile: string;
}

export function ClashPanel({ aliveCount }: Props) {
  const [info, setInfo] = useState<SnippetInfo | null>(null);
  const [tab, setTab] = useState<'provider' | 'snippet'>('provider');

  useEffect(() => {
    fetch(apiUrl('/api/proxy/clash-snippet'))
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      MessagePlugin.success('已复制到剪贴板');
    } catch {
      MessagePlugin.warning('剪贴板不可用，请手动复制');
    }
  };

  const download = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{ backgroundColor: 'var(--td-bg-color-container)', borderColor: 'var(--td-component-border)' }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link2 size={16} style={{ color: 'var(--td-brand-color)' }} />
          <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
            接入 Clash Verge
          </span>
          <Tag size="small" variant="outline">
            可导出 {aliveCount} 个节点
          </Tag>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--td-component-border)' }}>
            {(
              [
                ['provider', '订阅方式（推荐）'],
                ['snippet', '配置片段'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="px-3 py-1 text-xs transition-colors"
                style={{
                  backgroundColor: tab === key ? 'var(--td-brand-color-light)' : 'transparent',
                  color: tab === key ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            size="small"
            variant="outline"
            icon={<Download size={14} />}
            onClick={() => download('/api/proxy/clash.yaml', 'free-proxy-hunter.yaml')}
          >
            下载完整配置
          </Button>
        </div>
      </div>

      {tab === 'provider' ? (
        <div className="flex flex-col gap-2 text-[13px]" style={{ color: 'var(--td-text-color-secondary)' }}>
          <p className="leading-relaxed">
            Clash Verge 支持 <b>远程订阅</b> 与 <b>Proxy Provider</b> 两种方式。推荐使用 Provider：现有配置不用动，
            节点会按你设置的间隔自动跟随本应用的免费代理池刷新。
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs shrink-0">远程订阅地址</span>
            <code
              className="px-2 py-1 rounded font-mono text-xs flex-1 min-w-[240px] truncate"
              style={{ backgroundColor: 'var(--td-bg-color-component)' }}
            >
              http://127.0.0.1:3000/api/proxy/clash.yaml
            </code>
            <Button
              size="small"
              variant="outline"
              icon={<Copy size={14} />}
              onClick={() => copy('http://127.0.0.1:3000/api/proxy/clash.yaml')}
            >
              复制
            </Button>
          </div>
          <div className="text-xs leading-relaxed rounded-lg p-3" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
            <b style={{ color: 'var(--td-text-color-primary)' }}>操作路径</b>
            <br />
            1. Clash Verge → 「订阅」页 → 新建 → 类型选 <b>Remote</b>，粘贴上面的地址 → 保存并选中该配置
            <br />
            2. 或直接在「订阅」页把 <b>data/clash-proxies.yaml</b>（本应用每次测速后自动生成）拖进去，作为 Local 配置导入
            <br />
            3. 导入后在「代理」页把 <b>🚀 节点选择</b> 指向 <b>♻️ 自动选择</b>，即可由 Clash 自动挑选最快的免费节点
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs shrink-0">Provider 仅节点文件</span>
            <code
              className="px-2 py-1 rounded font-mono text-xs flex-1 min-w-[240px] truncate"
              style={{ backgroundColor: 'var(--td-bg-color-component)' }}
            >
              {info?.selfUrl ?? 'http://127.0.0.1:3000/api/proxy/clash-provider.yaml'}
            </code>
            <Button
              size="small"
              variant="outline"
              icon={<Copy size={14} />}
              onClick={() => copy(info?.selfUrl ?? 'http://127.0.0.1:3000/api/proxy/clash-provider.yaml')}
            >
              复制
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--td-text-color-secondary)' }}>
            把下面这段粘贴进你现有的 Clash Verge 配置（右键配置 → 编辑文件），即可让免费代理池作为独立分组接入，
            无需替换原有节点。
          </p>
          <pre
            className="text-xs font-mono p-3 rounded-lg overflow-auto max-h-64"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)' }}
          >
            {info?.snippet ?? '加载中…'}
          </pre>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              icon={<Copy size={14} />}
              onClick={() => copy(info?.snippet ?? '')}
              disabled={!info}
            >
              复制配置片段
            </Button>
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              本地生成文件：{info?.localFile ?? 'data/clash-proxies.yaml'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
