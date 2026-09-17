/**
 * Clash / Mihomo 配置生成器
 * ------------------------------------------------------------
 * 输出三样东西，覆盖 Clash Verge (Rev) 的全部接入姿势：
 *   1. 完整配置文件   → 直接下载导入 / 作为远程订阅
 *   2. Proxy Provider → 只含 proxies，供已有配置引用合并
 *   3. 订阅片段       → 复制粘贴到现有配置
 */

import type { ProxyRecord } from './types.js';
import { CLASH_FILE, DATA_DIR } from './store.js';
import fs from 'node:fs';

export interface ClashOptions {
  /** 健康检查地址 */
  healthCheckUrl?: string;
  /** 混合端口 */
  mixedPort?: number;
  /** 控制面板地址 */
  externalController?: string;
  /** 分组名前缀 */
  groupPrefix?: string;
  /** 是否只包含低延迟节点 */
  onlyFast?: boolean;
}

const DEFAULT_HEALTH = 'http://www.gstatic.com/generate_204';

function yamlStr(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 生成合法且易读的唯一节点名 */
function buildName(rec: ProxyRecord, index: number, prefix: string): string {
  const flag = countryFlag(rec.countryCode);
  const region = rec.city || rec.country || '未知';
  const latency = rec.latencyAvg ?? rec.latency ?? 0;
  const tag = `${flag}${region}-${latency}ms`;
  return `${prefix}${String(index + 1).padStart(3, '0')} ${tag}`;
}

function countryFlag(code?: string): string {
  if (!code || code.length !== 2) return '🌐';
  const base = 0x1f1e6;
  const chars = code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(base + (c.charCodeAt(0) - 65)));
  return chars.join('');
}

/** Clash 支持的代理类型映射 */
function clashType(rec: ProxyRecord): 'http' | 'socks5' {
  if (rec.protocol === 'socks4' || rec.protocol === 'socks5') return 'socks5';
  // https 代理在 Clash 中同样以 http 类型 + tls 标记表达
  return 'http';
}

interface BuiltNode {
  name: string;
  yaml: string;
}

export function buildNodes(records: ProxyRecord[], prefix = ''): BuiltNode[] {
  const nodes: BuiltNode[] = [];
  records.forEach((rec, index) => {
    const name = buildName(rec, index, prefix);
    const type = clashType(rec);
    const lines = [
      `  - name: ${yamlStr(name)}`,
      `    type: ${type}`,
      `    server: ${rec.host}`,
      `    port: ${rec.port}`,
      `    udp: false`,
      `    skip-cert-verify: true`,
    ];
    if (type === 'http' && rec.protocol === 'https') {
      lines.push(`    tls: true`);
    }
    nodes.push({ name, yaml: lines.join('\n') });
  });
  return nodes;
}

/** 生成完整 Clash 配置 */
export function buildClashConfig(records: ProxyRecord[], options: ClashOptions = {}): string {
  const {
    healthCheckUrl = DEFAULT_HEALTH,
    mixedPort = 7890,
    externalController = '127.0.0.1:9090',
    groupPrefix = 'FH-',
    onlyFast = false,
  } = options;

  const usable = onlyFast
    ? records.filter((r) => (r.latencyAvg ?? r.latency ?? 99999) <= 1500)
    : records;

  const nodes = buildNodes(usable, groupPrefix);
  const names = nodes.map((n) => yamlStr(n.name));
  const nameList = names.length > 0 ? names.map((n) => `      - ${n}`).join('\n') : '      - DIRECT';

  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });

  return `# ============================================================
# 免费代理猎手 · Clash Verge / Mihomo 配置
# 生成时间: ${generatedAt}
# 节点数量: ${nodes.length}
# 说明: 免费代理稳定性有限，建议将「自动选择」作为默认策略
# ============================================================

mixed-port: ${mixedPort}
allow-lan: false
bind-address: '*'
mode: rule
log-level: warning
ipv6: false
external-controller: ${externalController}
unified-delay: true
tcp-concurrent: true
find-process-mode: strict
global-client-fingerprint: chrome

profile:
  store-selected: true
  store-fake-ip: true

dns:
  enable: true
  ipv6: false
  listen: 0.0.0.0:1053
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - '*.lan'
    - '*.local'
    - 'localhost.ptlogin2.qq.com'
  nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - https://doh.pub/dns-query
  fallback:
    - 8.8.8.8
    - 1.1.1.1
    - tls://dns.google:853

proxies:
${nodes.length > 0 ? nodes.map((n) => n.yaml).join('\n') : '  []'}

proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ♻️ 自动选择
      - 🔯 故障转移
      - DIRECT
${nameList}

  - name: ♻️ 自动选择
    type: url-test
    url: ${healthCheckUrl}
    interval: 300
    tolerance: 60
    lazy: true
    proxies:
${nameList}

  - name: 🔯 故障转移
    type: fallback
    url: ${healthCheckUrl}
    interval: 300
    lazy: true
    proxies:
${nameList}

  - name: 🎯 全球直连
    type: select
    proxies:
      - DIRECT

rules:
  - DOMAIN-SUFFIX,cn,🎯 全球直连
  - DOMAIN-KEYWORD,-cn,🎯 全球直连
  - GEOIP,CN,🎯 全球直连,no-resolve
  - MATCH,🚀 节点选择
`;
}

/** 生成 Proxy Provider 文件（供已有配置合并引用） */
export function buildProviderYaml(records: ProxyRecord[]): string {
  const nodes = buildNodes(records, '');
  return `# 免费代理猎手 · Proxy Provider
# 生成时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}
# 节点数量: ${nodes.length}
proxies:
${nodes.length > 0 ? nodes.map((n) => n.yaml).join('\n') : '  []'}
`;
}

/** 生成可直接粘贴进现有配置的 provider 引用片段 */
export function buildProviderSnippet(selfUrl: string, healthCheckUrl = DEFAULT_HEALTH): string {
  return `# ▼ 把下面这段加到你的 Clash Verge 配置里，即可自动跟随免费代理池更新
proxy-providers:
  free-proxy-hunter:
    type: http
    url: "${selfUrl}"
    interval: 3600
    path: ./providers/free-proxy-hunter.yaml
    health-check:
      enable: true
      url: ${healthCheckUrl}
      interval: 300

# ▼ 再在 proxy-groups 中引用它
# proxy-groups:
#   - name: ♻️ 免费池-自动选择
#     type: url-test
#     use:
#       - free-proxy-hunter
#     url: ${healthCheckUrl}
#     interval: 300
#     tolerance: 60
`;
}

/** 同步导出到 data 目录，方便本机直接用文件方式导入 Clash Verge */
export function writeClashFiles(records: ProxyRecord[]): { path: string; count: number } {
  const content = buildClashConfig(records);
  const file = CLASH_FILE;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  } catch (e) {
    console.error('[Clash] 写文件失败：', (e as Error).message);
  }
  return { path: file, count: records.length };
}

/**
 * 生成一份「去重后」的 Clash 节点列表。
 * 免费池里同一出口 IP 常常重复，这里按 exitIp 收敛一次。
 */
export function dedupeForClash(records: ProxyRecord[]): ProxyRecord[] {
  const seen = new Set<string>();
  const out: ProxyRecord[] = [];
  for (const rec of records) {
    const key = rec.exitIp ?? `${rec.host}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}
