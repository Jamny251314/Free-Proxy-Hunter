/**
 * 免费代理源清单 + 解析器
 * ------------------------------------------------------------
 * 覆盖三类来源：
 *  1. 国内免费代理站（HTML 表格，GBK/UTF-8 混合）
 *  2. 国外公开代理 API（纯文本 / JSON）
 *  3. GitHub 上的高频维护代理列表仓库（raw 文本，质量最稳定）
 *
 * 解析统一输出 { host, port, protocol } 三元组，由 store 负责去重与打分。
 */

import type { ProxyProtocol, ProxySourceDef } from './types.js';

export const SOURCES: ProxySourceDef[] = [
  /* ---------------- GitHub 高频维护仓库（质量最稳） ---------------- */
  {
    key: 'thespeedx-http',
    name: 'TheSpeedX / HTTP',
    homepage: 'https://github.com/TheSpeedX/PROXY-List',
    protocol: 'http',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt'],
    note: 'GitHub 上更新最勤的公开 HTTP 代理列表之一',
  },
  {
    key: 'thespeedx-socks4',
    name: 'TheSpeedX / SOCKS4',
    homepage: 'https://github.com/TheSpeedX/PROXY-List',
    protocol: 'socks4',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt'],
  },
  {
    key: 'thespeedx-socks5',
    name: 'TheSpeedX / SOCKS5',
    homepage: 'https://github.com/TheSpeedX/PROXY-List',
    protocol: 'socks5',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt'],
  },
  {
    key: 'monosans-http',
    name: 'monosans / HTTP',
    homepage: 'https://github.com/monosans/proxy-list',
    protocol: 'http',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'],
    note: '仓库每 30 分钟自动更新，可用率较高',
  },
  {
    key: 'monosans-socks5',
    name: 'monosans / SOCKS5',
    homepage: 'https://github.com/monosans/proxy-list',
    protocol: 'socks5',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt'],
  },
  {
    key: 'proxifly-all',
    name: 'proxifly / 全协议',
    homepage: 'https://github.com/proxifly/free-proxy-list',
    protocol: 'http',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt'],
    note: '带协议前缀的混合列表，解析时按行识别',
  },
  {
    key: 'clarketm',
    name: 'clarketm / HTTP',
    homepage: 'https://github.com/clarketm/proxy-list',
    protocol: 'http',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt'],
  },
  {
    key: 'shiftytr-http',
    name: 'ShiftyTR / HTTP',
    homepage: 'https://github.com/ShiftyTR/Proxy-List',
    protocol: 'http',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt'],
  },
  {
    key: 'hookzof-socks5',
    name: 'hookzof / SOCKS5',
    homepage: 'https://github.com/hookzof/socks5_list',
    protocol: 'socks5',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt'],
  },
  {
    key: 'roosterkid-https',
    name: 'roosterkid / HTTPS',
    homepage: 'https://github.com/roosterkid/openproxylist',
    protocol: 'https',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt'],
  },
  {
    key: 'jetkai-http',
    name: 'jetkai / HTTP',
    homepage: 'https://github.com/jetkai/proxy-list',
    protocol: 'http',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt'],
  },
  {
    key: 'zloi-http',
    name: 'zloi-user / HTTP',
    homepage: 'https://github.com/zloi-user/hideip.me',
    protocol: 'http',
    kind: 'text',
    urls: ['https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt'],
  },

  /* ---------------- 公开代理 API ---------------- */
  {
    key: 'proxyscrape-http',
    name: 'ProxyScrape API / HTTP',
    homepage: 'https://proxyscrape.com/free-proxy-list',
    protocol: 'http',
    kind: 'text',
    urls: [
      'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000',
    ],
    note: '官方 API，返回纯 ip:port 文本',
  },
  {
    key: 'proxyscrape-socks5',
    name: 'ProxyScrape API / SOCKS5',
    homepage: 'https://proxyscrape.com/free-proxy-list',
    protocol: 'socks5',
    kind: 'text',
    urls: [
      'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=ipport&format=text&timeout=5000',
    ],
  },
  {
    key: 'proxy-list-download',
    name: 'proxy-list.download / 混合',
    homepage: 'https://www.proxy-list.download',
    protocol: 'http',
    kind: 'text',
    urls: [
      'https://www.proxy-list.download/api/v1/get?type=http',
      'https://www.proxy-list.download/api/v1/get?type=socks4',
      'https://www.proxy-list.download/api/v1/get?type=socks5',
      'https://www.proxy-list.download/api/v1/get?type=https',
    ],
  },
  {
    key: 'openproxy-space',
    name: 'openproxy.space / 混合',
    homepage: 'https://openproxy.space',
    protocol: 'http',
    kind: 'text',
    urls: [
      'https://openproxy.space/list/http',
      'https://openproxy.space/list/socks5',
    ],
    note: 'JS 站点，需从内嵌数据中提取 ip:port',
  },

  /* ---------------- 国内免费代理站（HTML 分页） ---------------- */
  {
    key: 'kuaidaili',
    name: '快代理 免费代理',
    homepage: 'https://www.kuaidaili.com/free/',
    protocol: 'http',
    kind: 'html',
    urls: ['https://www.kuaidaili.com/free/inha/{page}/'],
    pages: 4,
    // 实测：站点启用腾讯 EdgeOne 机器人防护，返回 EO_Bot_Ssid 混淆 JS 挑战页（~986 字节），
    // 需执行 JS 并回传 Cookie 才能拿到真实表格，静态抓取无法通过
    disabled: true,
    note: '已停用：受腾讯 EdgeOne 机器人防护拦截，返回 JS 挑战页，需浏览器环境才能通过',
  },
  {
    key: 'kuaidaili-intl',
    name: '快代理 国际版',
    homepage: 'https://www.kuaidaili.com/free/',
    protocol: 'http',
    kind: 'html',
    urls: ['https://www.kuaidaili.com/free/intr/{page}/'],
    pages: 3,
    // 同快代理主站，受 EdgeOne 机器人挑战拦截
    disabled: true,
    note: '已停用：与主站同一套 EdgeOne 防护，静态请求拿不到代理表格',
  },
  {
    key: 'ip89',
    name: '89免费代理',
    homepage: 'https://www.89ip.cn/',
    protocol: 'http',
    kind: 'html',
    urls: ['https://www.89ip.cn/index_{page}.html'],
    pages: 6,
    note: 'HTML 表格，量大、时效性一般',
  },
  {
    key: 'ip89-api',
    name: '89免费代理 / 提取接口',
    homepage: 'https://www.89ip.cn/',
    protocol: 'http',
    kind: 'text',
    // 单次返回 100 条，<br> 分隔的 ip:port 列表，是当前量最大的一条线路
    urls: ['https://www.89ip.cn/tqdl.html?api=1&num=100&port=&address=&isp='],
    note: '一次给 100 条，纯文本 <br> 分隔',
  },
  {
    key: 'ip3366',
    name: '云代理',
    homepage: 'https://proxy.ip3366.net/free/',
    protocol: 'http',
    kind: 'html',
    // 实测 HTTPS 域名比主站稳定（主站间歇返回 521 JS 挑战）
    urls: ['https://proxy.ip3366.net/free/?action=china&page={page}'],
    pages: 4,
    note: '表格含「类型」列，按行识别 http / https / socks',
  },
  {
    key: 'ip3366-global',
    name: '云代理 / 全球线路',
    homepage: 'http://www.ip3366.net/free/',
    protocol: 'http',
    kind: 'html',
    urls: ['http://www.ip3366.net/free/?stype=2&page={page}'],
    pages: 3,
    note: '站点为 GB2312 编码，仅取其中的 IP/端口/类型字段',
  },
  {
    key: 'kxdaili',
    name: '开心代理',
    homepage: 'http://www.kxdaili.com/dailiip.html',
    protocol: 'http',
    kind: 'html',
    urls: ['http://www.kxdaili.com/dailiip/{page}/1.html'],
    pages: 5,
    // 实测：返回 JS Cookie 挑战页（1002 字节的 setCookie + location.replace），无法静态解析
    disabled: true,
    note: '已停用：返回 JS Cookie 挑战页，静态抓取无法通过',
  },
  {
    key: 'ip66',
    name: '66免费代理网',
    homepage: 'http://www.66ip.cn/',
    protocol: 'http',
    kind: 'html',
    urls: ['http://www.66ip.cn/{page}.html'],
    pages: 8,
    // 实测：站点改版，/{page}.html 与 nmtq.php 接口均返回 404
    disabled: true,
    note: '已停用：站点改版，/{page}.html 与 nmtq.php 提取接口均返回 404',
  },
  {
    key: 'ihuan',
    name: '小幻 HTTP 代理',
    homepage: 'https://ip.ihuan.me/',
    protocol: 'http',
    kind: 'html',
    urls: ['https://ip.ihuan.me/address/{page}.html'],
    pages: 5,
    note: '需从表格中提取，含匿名度与响应时间字段',
  },
  {
    key: 'zdaye',
    name: '站大爷 免费代理',
    homepage: 'https://www.zdaye.com/free/',
    protocol: 'http',
    kind: 'html',
    urls: ['https://www.zdaye.com/free/{page}/'],
    pages: 5,
    // 实测：直连返回 HTTP 405，需带完整浏览器指纹与 Cookie 才能访问，暂时关闭
    disabled: true,
    note: '已停用：直连返回 HTTP 405，需完整浏览器指纹与 Cookie',
  },
  {
    key: 'goubanjia',
    name: '全网代理',
    homepage: 'http://www.goubanjia.com/',
    protocol: 'http',
    kind: 'html',
    urls: ['http://www.goubanjia.com/'],
    // 实测：直连超时不可达
    disabled: true,
    note: '已停用：直连超时不可达',
  },
  {
    key: 'proxy-list-cn',
    name: 'ProxyList+ 国内节点',
    homepage: 'https://www.proxy-list.download/CN',
    protocol: 'http',
    kind: 'text',
    urls: ['https://www.proxy-list.download/api/v1/get?type=http&country=CN'],
  },
];

/* ------------------------------------------------------------------ */
/* GitHub raw 镜像自动扩展                                             */
/* ------------------------------------------------------------------ */
/**
 * 本机实测 raw.githubusercontent.com 及其常见镜像在部分网络下不可达。
 * 这里为每个 GitHub 源生成一组镜像地址，采集时并发竞速取最快可用者，
 * 单一线路失效不会导致整个源采不到数据。
 */
function expandGithubMirrors(rawUrl: string): string[] {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(rawUrl);
  if (!m) return [rawUrl];
  const [, user, repo, branch, file] = m;
  const gh = `${user}/${repo}`;
  return [
    rawUrl,
    `https://cdn.jsdelivr.net/gh/${gh}@${branch}/${file}`,
    `https://fastly.jsdelivr.net/gh/${gh}@${branch}/${file}`,
    `https://gcore.jsdelivr.net/gh/${gh}@${branch}/${file}`,
    `https://raw.gitmirror.com/${gh}/${branch}/${file}`,
    `https://ghproxy.net/${rawUrl}`,
    `https://gh-proxy.com/${rawUrl}`,
    `https://ghfast.top/${rawUrl}`,
  ];
}

for (const source of SOURCES) {
  const first = source.urls[0];
  if (first && first.startsWith('https://raw.githubusercontent.com/')) {
    source.urls = expandGithubMirrors(first);
    source.mirrors = true;
    // 镜像众多，单次超时压低到 7 秒，避免全链路阻塞
    source.timeoutMs = source.timeoutMs ?? 7000;
  }
}

/** key 重复会让日志/统计出现两条同名记录，这里在启动期直接暴露问题 */
const duplicateKeys = SOURCES.map((s) => s.key).filter((k, i, arr) => arr.indexOf(k) !== i);
if (duplicateKeys.length > 0) {
  throw new Error(`代理源清单存在重复 key：${[...new Set(duplicateKeys)].join(', ')}`);
}

/* ------------------------------------------------------------------ */
/* 解析器                                                              */
/* ------------------------------------------------------------------ */

const IP_PORT_RE = /\b((?:\d{1,3}\.){3}\d{1,3})\s*[:：]\s*(\d{1,5})\b/g;
const IP_ONLY_RE = /\b((?:\d{1,3}\.){3}\d{1,3})\b/g;

export interface ParsedProxy {
  host: string;
  port: number;
  protocol: ProxyProtocol;
}

function isValidIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  // 排除保留/内网段
  const [a, b] = parts;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a >= 224) return false;
  return true;
}

function isValidPort(p: number): boolean {
  return Number.isInteger(p) && p > 0 && p < 65536;
}

/**
 * 从 HTML 表格中抽取 ip:port —— 把 </td><td> 变成分隔符，再剥标签。
 * 同时尝试从同一行后续文本中识别协议（ip3366 等站点会带「类型」列，
 * 把 SOCKS 节点误标成 HTTP 会导致测速必然失败）。
 */
function parseHtmlTable(html: string): Array<{ ip: string; port: number; protocol?: ProxyProtocol }> {
  const out: Array<{ ip: string; port: number; protocol?: ProxyProtocol }> = [];

  // 1) 常见表格结构：<td>1.2.3.4</td><td>8080</td>
  const normalized = html
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');

  for (const m of normalized.matchAll(/\b((?:\d{1,3}\.){3}\d{1,3})\b[^\d]{1,12}(\d{2,5})\b/g)) {
    const ip = m[1];
    const port = Number(m[2]);
    if (!isValidIp(ip) || !isValidPort(port)) continue;
    // 端口后方的文本里若出现协议关键字，则采纳（限制在同一行内，避免串行污染）
    const tail = normalized.slice(m.index + m[0].length, m.index + m[0].length + 48);
    const proto = /(socks5|socks4|https|http)/i.exec(tail.split('\n')[0])?.[1];
    out.push({ ip, port, protocol: proto ? normalizeProtocol(proto) ?? undefined : undefined });
  }

  // 2) 兜底：页面里内嵌的 JSON / JS 字符串 "ip":"1.2.3.4","port":8080
  for (const m of html.matchAll(
    /["']?(?:ip|host|server)["']?\s*[:=]\s*["']((?:\d{1,3}\.){3}\d{1,3})["'][^}]{0,80}?["']?(?:port)["']?\s*[:=]\s*["']?(\d{2,5})/gi,
  )) {
    const ip = m[1];
    const port = Number(m[2]);
    if (isValidIp(ip) && isValidPort(port)) out.push({ ip, port });
  }

  return out;
}

/** 解析纯文本列表，识别 socks5:// 前缀与裸 ip:port / ip:port:protocol */
function parseTextList(
  text: string,
  fallbackProtocol: ProxyProtocol,
): Array<{ ip: string; port: number; protocol: ProxyProtocol }> {
  const out: Array<{ ip: string; port: number; protocol: ProxyProtocol }> = [];
  // 部分接口（如 89ip 的 tqdl 提取接口）直接吐一段 HTML：条目用 <br> 分隔，
  // 且第一条前面还挂着广告 div 与 jquery script。因此先清掉脚本与标签、
  // 把 <br> 变成换行，否则「首条与页面杂项同行」会导致该条被整行丢弃。
  const cleaned = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
  const lines = cleaned.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // 形态 A: scheme://ip:port
    const schemeMatch = /^(https?|socks4a?|socks5h?):\/\/([^\s/]+)/i.exec(line);
    if (schemeMatch) {
      const proto = normalizeProtocol(schemeMatch[1]);
      const hp = parseHostPort(schemeMatch[2]);
      if (hp && isValidIp(hp.ip) && isValidPort(hp.port)) {
        out.push({ ip: hp.ip, port: hp.port, protocol: proto ?? fallbackProtocol });
      }
      continue;
    }

    // 形态 B: ip:port:protocol 或 ip:port@protocol
    const triple = /^((?:\d{1,3}\.){3}\d{1,3})\s*[:@]\s*(\d{2,5})\s*[:@]\s*(https?|socks4a?|socks5h?)\b/i.exec(line);
    if (triple) {
      const proto = normalizeProtocol(triple[3]) ?? fallbackProtocol;
      if (isValidIp(triple[1]) && isValidPort(Number(triple[2]))) {
        out.push({ ip: triple[1], port: Number(triple[2]), protocol: proto });
      }
      continue;
    }

    // 形态 C: 裸 ip:port
    const hp = parseHostPort(line);
    if (hp && isValidIp(hp.ip) && isValidPort(hp.port)) {
      out.push({ ip: hp.ip, port: hp.port, protocol: fallbackProtocol });
      continue;
    }

    // 形态 D: 带 user:pass 的 ip:port（丢弃认证信息）
    const auth = /^[^\s:]+:[^\s@]+@((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})/.exec(line);
    if (auth && isValidIp(auth[1]) && isValidPort(Number(auth[2]))) {
      out.push({ ip: auth[1], port: Number(auth[2]), protocol: fallbackProtocol });
      continue;
    }

    // 形态 E: 行内嵌有 ip:port —— 剥离标签后仍可能残留广告文案等前缀，
    // 例如 89ip 提取接口的首条就是「广告文本 + 190.6.204.143:999」。
    // 前面必须是行首或非数字非点号的字符，避免从更长的数字串中间截取出假 IP。
    let embedded = 0;
    for (const m of line.matchAll(/(?:^|[^\d.])((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})(?!\d)/g)) {
      if (isValidIp(m[1]) && isValidPort(Number(m[2]))) {
        out.push({ ip: m[1], port: Number(m[2]), protocol: fallbackProtocol });
        embedded++;
      }
    }
    if (embedded > 0) continue;
  }

  return out;
}

function normalizeProtocol(raw: string): ProxyProtocol | null {
  const p = raw.toLowerCase();
  if (p === 'http') return 'http';
  if (p === 'https') return 'https';
  if (p === 'socks4' || p === 'socks4a') return 'socks4';
  if (p === 'socks5' || p === 'socks5h') return 'socks5';
  return null;
}

function parseHostPort(value: string): { ip: string; port: number } | null {
  const clean = value.replace(/[/#?].*$/, '').trim();
  const m = /^((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})$/.exec(clean);
  if (!m) return null;
  return { ip: m[1], port: Number(m[2]) };
}

/**
 * 统一解析入口：根据源类型选择解析策略，并做一轮「同源去重」。
 */
export function parseSourcePayload(
  source: ProxySourceDef,
  body: string,
  contentType = '',
): ParsedProxy[] {
  const collected: ParsedProxy[] = [];

  if (source.kind === 'json' || contentType.includes('json')) {
    const fromJson = parseJsonPayload(body, source.protocol);
    if (fromJson.length > 0) collected.push(...fromJson);
  }

  if (collected.length === 0) {
    for (const item of parseTextList(body, source.protocol)) {
      collected.push({ host: item.ip, port: item.port, protocol: item.protocol });
    }
  }

  if (collected.length === 0 && source.kind === 'html') {
    for (const item of parseHtmlTable(body)) {
      // 行内识别出的协议优先于源默认协议
      collected.push({ host: item.ip, port: item.port, protocol: item.protocol ?? source.protocol });
    }
  }

  // 若文本解析失败但内容里确有 ip:port（某些接口返回 JSON 但没有预期字段），再兜底一次
  if (collected.length === 0) {
    for (const item of parseHtmlTable(body)) {
      collected.push({ host: item.ip, port: item.port, protocol: item.protocol ?? source.protocol });
    }
  }

  const seen = new Set<string>();
  const unique: ParsedProxy[] = [];
  for (const p of collected) {
    const key = `${p.protocol}://${p.host}:${p.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique;
}

/** 解析 JSON 数组 / 对象形式（如 proxifly 的 data.json、各 API 的 json 模式） */
function parseJsonPayload(body: string, fallback: ProxyProtocol): ParsedProxy[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const out: ParsedProxy[] = [];
  const list = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { data?: unknown }).data)
      ? ((data as { data: unknown[] }).data)
      : typeof data === 'object' && data !== null && Array.isArray((data as { proxies?: unknown }).proxies)
        ? ((data as { proxies: unknown[] }).proxies)
        : [];

  for (const item of list) {
    if (typeof item === 'string') {
      const m = /^(?:(https?|socks4a?|socks5h?):\/\/)?((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})$/.exec(item.trim());
      if (m && isValidIp(m[2]) && isValidPort(Number(m[3]))) {
        out.push({
          host: m[2],
          port: Number(m[3]),
          protocol: m[1] ? normalizeProtocol(m[1]) ?? fallback : fallback,
        });
      }
      continue;
    }
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      const ip = String(obj.ip ?? obj.host ?? obj.proxy ?? obj.server ?? '');
      const port = Number(obj.port ?? obj.proxyPort ?? 0);
      const protoRaw = String(obj.protocol ?? obj.type ?? '');
      const proto = normalizeProtocol(protoRaw) ?? fallback;
      if (isValidIp(ip) && isValidPort(port)) {
        out.push({ host: ip, port, protocol: proto });
      }
    }
  }
  return out;
}

/** 排除明显无效的采集结果 */
export function sanitizeParsed(list: ParsedProxy[]): ParsedProxy[] {
  return list.filter((p) => isValidIp(p.host) && isValidPort(p.port));
}
