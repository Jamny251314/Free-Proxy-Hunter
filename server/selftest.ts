#!/usr/bin/env node
/**
 * 代理猎手 · 离线自检
 * ------------------------------------------------------------
 * 不依赖网络，用真实结构样例验证三块核心逻辑：
 *   1. 各类型代理源的解析器（HTML 表格 / 纯文本 / 混合前缀 / JSON API）
 *   2. IP / 端口合法性过滤
 *   3. 评分模型与 Clash 配置生成
 *
 * 用法: npm run proxy:selftest
 */

import { parseSourcePayload, sanitizeParsed, SOURCES } from './proxy/sources.js';
import { buildClashConfig, buildProviderSnippet, buildProviderYaml, dedupeForClash } from './proxy/clash.js';
import { computeScore, createRecord } from './proxy/store.js';
import { INFO_TARGETS, PING_TARGETS, isPublicIp, type ProbeTarget, type RawResponse } from './proxy/net.js';
import type { ProxySourceDef } from './proxy/types.js';

let passed = 0;
let failed = 0;

function check(title: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    process.stdout.write(`  ✓ ${title}\n`);
  } else {
    failed++;
    process.stdout.write(`  ✗ ${title}${detail ? `  →  ${detail}` : ''}\n`);
  }
}

function section(title: string): void {
  process.stdout.write(`\n${title}\n`);
}

/* ------------------------------------------------------------------ */
/* 1. 解析器                                                           */
/* ------------------------------------------------------------------ */

section('1. 代理源解析器');

// --- 国内站点：典型 HTML 表格（ip 与 port 分处两个 <td>） ---
const kuaidailiHtml = `
<div class="table">
<table>
  <thead><tr><th>IP</th><th>PORT</th><th>匿名度</th><th>类型</th><th>位置</th></tr></thead>
  <tbody>
    <tr><td>122.9.101.11</td><td>8090</td><td>高匿名</td><td>HTTP</td><td>中国 山西 太原</td></tr>
    <tr><td data-title="IP">114.106.163.199</td><td data-title="PORT">8080</td><td>匿名</td><td>HTTP</td><td>中国 安徽</td></tr>
    <tr><td>27.44.80.23</td><td>9999</td><td>透明</td><td>HTTP</td><td>中国 广东 深圳</td></tr>
  </tbody>
</table>
</div>
<script>var pageInfo = {"page":1,"total":20};</script>
`;

const srcHtml: ProxySourceDef = {
  key: 'fixture-html',
  name: 'fixture',
  homepage: '',
  protocol: 'http',
  kind: 'html',
  urls: [],
};
const htmlParsed = sanitizeParsed(parseSourcePayload(srcHtml, kuaidailiHtml, 'text/html'));
check('HTML 表格解析出 3 条', htmlParsed.length === 3, `实际 ${htmlParsed.length}`);
check(
  'HTML 解析结果正确（ip 与 port 配对）',
  htmlParsed.some((p) => p.host === '122.9.101.11' && p.port === 8090) &&
    htmlParsed.some((p) => p.host === '114.106.163.199' && p.port === 8080) &&
    htmlParsed.some((p) => p.host === '27.44.80.23' && p.port === 9999),
  JSON.stringify(htmlParsed),
);

// --- 带行内 JS 数据的站点（openproxy.space 风格） ---
const embeddedJs = `<html><body><script>
  window.__DATA__ = [{"ip":"103.152.112.162","port":80},{"ip":"45.61.184.149","port":1080}];
  document.write('<td>185.199.229.156</td><td>22</td>');
</script></body></html>`;
const jsParsed = sanitizeParsed(parseSourcePayload(srcHtml, embeddedJs, 'text/html'));
check(
  '内嵌 JS 数据可被识别',
  jsParsed.some((p) => p.host === '103.152.112.162' && p.port === 80) &&
    jsParsed.some((p) => p.host === '45.61.184.149' && p.port === 1080),
  JSON.stringify(jsParsed),
);

// --- 纯文本：裸 ip:port + 内网地址应被过滤 ---
const textPlain = `1.2.3.4:8080
5.6.7.8:3128
192.168.1.1:8888
10.0.0.5:1080
127.0.0.1:7890
# 注释行
9.9.9.9:1080`;
const srcText: ProxySourceDef = { ...srcHtml, key: 'fixture-text', kind: 'text', protocol: 'http' };
const textParsed = sanitizeParsed(parseSourcePayload(srcText, textPlain, 'text/plain'));
check('纯文本解析出 3 条公网代理', textParsed.length === 3, JSON.stringify(textParsed));
check(
  '内网 / 回环地址被过滤',
  !textParsed.some((p) => /^(192\.168|10\.|127\.)/.test(p.host)),
  JSON.stringify(textParsed.map((p) => p.host)),
);

// --- 混合协议前缀（proxifly 风格，含 socks4:// 与 socks5://） ---
const mixed = `socks5://198.51.100.7:1080
http://203.0.113.9:3128
socks4://198.51.100.20:9050`;
const srcMixed: ProxySourceDef = { ...srcText, key: 'fixture-mixed', protocol: 'http' };
const mixedParsed = parseSourcePayload(srcMixed, mixed, 'text/plain');
check(
  '协议前缀被正确识别',
  mixedParsed.some((p) => p.protocol === 'socks5' && p.host === '198.51.100.7') &&
    mixedParsed.some((p) => p.protocol === 'http' && p.host === '203.0.113.9') &&
    mixedParsed.some((p) => p.protocol === 'socks4' && p.host === '198.51.100.20'),
  JSON.stringify(mixedParsed),
);

// --- 带认证信息与 ip:port:protocol 形态 ---
const withAuth = `user:pass@198.51.100.31:8080
198.51.100.32:8080:socks5`;
const authParsed = parseSourcePayload(srcMixed, withAuth, 'text/plain');
check(
  '认证信息剥离 + ip:port:protocol 形态',
  authParsed.some((p) => p.host === '198.51.100.31' && p.port === 8080) &&
    authParsed.some((p) => p.host === '198.51.100.32' && p.protocol === 'socks5'),
  JSON.stringify(authParsed),
);

// --- JSON API ---
const jsonPayload = JSON.stringify([
  { ip: '198.51.100.41', port: 8080, protocol: 'http' },
  { ip: '198.51.100.42', port: 1080, protocol: 'socks5' },
]);
const jsonParsed = parseSourcePayload(srcMixed, jsonPayload, 'application/json');
check(
  'JSON API 解析',
  jsonParsed.length === 2 && jsonParsed[1].protocol === 'socks5',
  JSON.stringify(jsonParsed),
);

// --- 同源去重 ---
const duped = parseSourcePayload(srcMixed, `1.2.3.4:8080\n1.2.3.4:8080\n5.6.7.8:8080`, 'text/plain');
check('同源内去重生效', duped.length === 2, JSON.stringify(duped));

// --- 端口越界应被过滤 ---
const badPorts = sanitizeParsed(parseSourcePayload(srcMixed, `1.2.3.4:99999\n1.2.3.4:0\n5.6.7.8:8080`, 'text/plain'));
check('非法端口被过滤', badPorts.length === 1, JSON.stringify(badPorts));

// --- <br> 分隔的纯文本列表（89ip 的 tqdl 提取接口就是这种形态，整页没有换行符）---
const brList = `<a href="/x">广告</a><script>var a=1;</script>190.6.204.143:999<br>104.17.200.7:80<br>114.55.84.12:30001<br>`;
const brParsed = sanitizeParsed(parseSourcePayload({ ...srcText, key: 'fixture-br' }, brList, 'text/html'));
check('<br> 分隔列表可解析', brParsed.length === 3, JSON.stringify(brParsed));
check('<br> 分隔时 IP 与端口正确配对', brParsed[0]?.host === '190.6.204.143' && brParsed[0]?.port === 999, JSON.stringify(brParsed[0]));

// --- 表格内带「类型」列时，应按行识别协议（ip3366 风格）---
const typedTable = `<table><tbody>
<tr><th>114.231.45.121</th><th>8888</th><th>高匿</th><th>http</th><th>中国 江苏 南通</th></tr>
<tr><th>221.194.147.197</th><th>1080</th><th>高匿</th><th>socks5</th><th>河北 廊坊</th></tr>
<tr><td>117.62.31.158</td><td>8088</td><td>高匿</td><td>https</td><td>江苏 苏州</td></tr>
</tbody></table>`;
const typedParsed = parseSourcePayload({ ...srcHtml, key: 'fixture-typed', protocol: 'http' }, typedTable, 'text/html');
check('表格行内协议被识别', typedParsed.length === 3, JSON.stringify(typedParsed));
check('SOCKS5 行标记为 socks5', typedParsed.find((p) => p.host === '221.194.147.197')?.protocol === 'socks5', JSON.stringify(typedParsed));
check('https 行标记为 https', typedParsed.find((p) => p.host === '117.62.31.158')?.protocol === 'https', JSON.stringify(typedParsed));
check('http 行保持 http', typedParsed.find((p) => p.host === '114.231.45.121')?.protocol === 'http', JSON.stringify(typedParsed));

/* ------------------------------------------------------------------ */
/* 1.5 出口 IP 合法性（假存活防线）                                     */
/* ------------------------------------------------------------------ */

section('1.5 出口 IP 合法性校验');

check('公网 IP 通过', isPublicIp('58.222.237.66'));
check('内网 10.x 被拒', !isPublicIp('10.0.0.1'));
check('内网 192.168.x 被拒', !isPublicIp('192.168.100.250'));
check('环回 127.x 被拒', !isPublicIp('127.0.0.1'));
check('链路本地 169.254.x 被拒', !isPublicIp('169.254.1.1'));
check('CGNAT 100.64-127 被拒', !isPublicIp('100.100.1.1'));
check('空值被拒', !isPublicIp(undefined));

/* ------------------------------------------------------------------ */
/* 1.6 探测目标的反假存活性质                                            */
/* ------------------------------------------------------------------ */

section('1.6 探测目标的反假存活性质');

const ALL_TARGETS: ProbeTarget[] = [...INFO_TARGETS, ...PING_TARGETS];

function asRaw(body: string, statusCode = 200): RawResponse {
  return { statusCode, headers: {}, body, raw: body };
}

/**
 * 「回显式跳转页」——假存活最典型的形状。
 * 一台并非代理的普通 HTTP 服务器收到 absolute-form 请求行时会忽略绝对 URI，
 * 于是对任何目标都返回同一个通用跳转页；而跳转页正文里的
 * `<a HREF="https://<请求主机>/">` 天然含有目标主机名，
 * 使「正文是否含目标关键字」这类弱校验恒为真。
 */
function spoofRedirect(url: string): string {
  const host = new URL(url).host;
  return `<head><title>文档已移动</title></head><body><h1>对象已移动</h1>可在<a HREF="https://${host}/">此处</a>找到该文档</body>`;
}

check('每个探测目标都带内容校验', ALL_TARGETS.every((t) => typeof t.verify === 'function'),
  ALL_TARGETS.filter((t) => !t.verify).map((t) => t.url).join(','));
check('所有信息目标都要求出口 IP', INFO_TARGETS.every((t) => t.requireIp === true),
  INFO_TARGETS.filter((t) => !t.requireIp).map((t) => t.url).join(','));
check('信息目标都是 http://（httpViaProxy 只支持明文）',
  INFO_TARGETS.some((t) => t.url.startsWith('http://')));

// 核心性质：任何目标都不得被「回显自己主机名的跳转页」骗过
const fooled = ALL_TARGETS
  .filter((t) => t.verify && t.verify(asRaw(spoofRedirect(t.url), 301)))
  .map((t) => t.url);
check('无目标被回显式跳转页骗过', fooled.length === 0, fooled.join(','));

// 同上，但走 parse：要求 IP 的目标不得从跳转页里解出公网出口 IP
const ghostIp = ALL_TARGETS
  .filter((t) => t.requireIp && isPublicIp(t.parse(asRaw(spoofRedirect(t.url), 301)).exitIp))
  .map((t) => t.url);
check('回显式跳转页解不出公网出口 IP', ghostIp.length === 0, ghostIp.join(','));

// 已移除的伪目标：http 下只会 3xx，无法在不跟跳转的前提下使用
check('不再使用只回 3xx 的 baidu 作为兜底目标',
  !ALL_TARGETS.some((t) => /baidu/i.test(t.url)));
check('没有目标把 3xx 写进 accept',
  ALL_TARGETS.every((t) => !(t.accept ?? []).some((c) => c >= 300 && c < 400)),
  ALL_TARGETS.filter((t) => (t.accept ?? []).some((c) => c >= 300 && c < 400)).map((t) => t.url).join(','));

// cip.cc 是 ipip 之后的第二顺位信息目标，必须能同时解出 IP 与地区
const cipTarget = INFO_TARGETS.find((t) => t.url.includes('cip.cc'));
check('cip.cc 已在信息目标中', Boolean(cipTarget));
const cipPage = `<html><head><title>互连协议查询 - IP查询</title></head><body>
<pre>
IP	: 183.215.23.242
地址	: 中国 湖南 娄底
运营商	: 移动

数据二	: 中国 湖南 长沙 | 移动

数据三	: 中国 湖南省 娄底市 | 移动

URL	: http://www.cip.cc/183.215.23.242
</pre></body></html>`;
if (cipTarget) {
  const parsed = cipTarget.parse(asRaw(cipPage));
  check('cip.cc 解析出出口 IP', parsed.exitIp === '183.215.23.242', String(parsed.exitIp));
  check('cip.cc 解析出国家 + ISO 代码', parsed.country === '中国' && parsed.countryCode === 'CN',
    `${parsed.country}/${parsed.countryCode}`);
  check('cip.cc 解析出省 / 市 / 运营商',
    parsed.region === '湖南' && parsed.city === '娄底' && parsed.isp === '移动',
    JSON.stringify(parsed));
  check('cip.cc 真实页面通过校验', cipTarget.verify?.(asRaw(cipPage)) === true);
  check('cip.cc 跳转页不通过校验', cipTarget.verify?.(asRaw(spoofRedirect(cipTarget.url), 301)) === false);
  // 只有 IP 没有地址时，不应伪造出地区
  const ipOnly = cipTarget.parse(asRaw('<pre>IP\t: 8.8.8.8\n</pre>'));
  check('cip.cc 缺地址字段时不臆造地区',
    ipOnly.exitIp === '8.8.8.8' && !ipOnly.country && !ipOnly.city, JSON.stringify(ipOnly));
}

// 中国香港 / 中国台湾 / 中国澳门 的 ISO 映射必须存在（地区展示依赖它）
const cipHk = INFO_TARGETS.find((t) => t.url.includes('cip.cc'))
  ?.parse(asRaw('<pre>IP\t: 1.1.1.1\n地址\t: 中国香港\n运营商\t: HKT\n</pre>'));
check('中国香港 → HK', cipHk?.countryCode === 'HK', JSON.stringify(cipHk));

/* ------------------------------------------------------------------ */
/* 2. 评分模型                                                         */
/* ------------------------------------------------------------------ */

section('2. 评分模型');

const fast = createRecord('socks5', '1.1.1.1', 1080, 't');
fast.status = 'alive';
fast.latency = 120;
fast.latencyAvg = 120;
fast.success = 9;
fast.fail = 1;
fast.anonymity = 'elite';
fast.lastAlive = new Date().toISOString();

const slow = createRecord('http', '2.2.2.2', 8080, 't');
slow.status = 'alive';
slow.latency = 2600;
slow.latencyAvg = 2600;
slow.success = 2;
slow.fail = 2;
slow.anonymity = 'transparent';
slow.lastAlive = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

const dead = createRecord('http', '3.3.3.3', 8080, 't');
dead.status = 'dead';

const sFast = computeScore(fast);
const sSlow = computeScore(slow);
check('低延迟高匿节点得分 > 80', sFast > 80, `得分 ${sFast}`);
check('高延迟透明节点得分 < 50', sSlow < 50, `得分 ${sSlow}`);
check('失效节点得分为 0', computeScore(dead) === 0, `得分 ${computeScore(dead)}`);
check('评分排序符合预期 (fast > slow > dead)', sFast > sSlow && sSlow > computeScore(dead));

/* ------------------------------------------------------------------ */
/* 3. Clash 配置生成                                                   */
/* ------------------------------------------------------------------ */

section('3. Clash 配置生成');

const cluster = [fast, slow];
const cfg = buildClashConfig(dedupeForClash(cluster));
check('包含 mixed-port', cfg.includes('mixed-port: 7890'));
check('包含 proxy-groups', cfg.includes('proxy-groups:'));
check('包含 url-test 分组', cfg.includes('type: url-test'));
check('包含 fallback 分组', cfg.includes('type: fallback'));
check('socks5 节点类型正确', cfg.includes('type: socks5'));
check('http 节点类型正确', cfg.includes('type: http'));
check('节点名称带延迟标记', /\d+ms"/.test(cfg));
check('包含 CN 直连规则', cfg.includes('GEOIP,CN,🎯 全球直连,no-resolve'));
check('包含 MATCH 兜底规则', cfg.includes('MATCH,🚀 节点选择'));
// 节点名经 yamlStr 加引号，分组名不加引号，据此精确统计节点数
check(
  '节点数量与输入一致',
  (cfg.match(/^ {2}- name: "/gm) ?? []).length === 2,
  `实际 ${(cfg.match(/^ {2}- name: "/gm) ?? []).length}`,
);

// YAML 基础结构校验：缩进层级、无 undefined / NaN
check('不含 undefined 字面量', !cfg.includes('undefined'));
check('不含 NaN 字面量', !cfg.includes('NaN'));
check('无未替换的占位符', !cfg.includes('{') && !cfg.includes('}'));

const providerYaml = buildProviderYaml(cluster);
check('Provider 文件仅含 proxies 段', providerYaml.includes('proxies:') && !providerYaml.includes('proxy-groups:'));
check('Provider 节点数正确', providerYaml.split('\n').filter((l) => l.startsWith('  - name:')).length === 2);

const snippet = buildProviderSnippet('http://127.0.0.1:3000/api/proxy/clash-provider.yaml');
check('片段含 proxy-providers', snippet.includes('proxy-providers:'));
check('片段含订阅 URL', snippet.includes('clash-provider.yaml'));

// 去重：同一出口 IP 只保留一条
const dupRecords = [
  { ...fast, id: 'a', exitIp: '9.9.9.9' },
  { ...fast, id: 'b', exitIp: '9.9.9.9' },
  { ...slow, id: 'c', exitIp: '8.8.8.8' },
];
check('按出口 IP 去重', dedupeForClash(dupRecords).length === 2);

/* ------------------------------------------------------------------ */
/* 4. 空池边界                                                         */
/* ------------------------------------------------------------------ */

section('4. 空池边界');

const emptyCfg = buildClashConfig([]);
check('空池不产生节点', (emptyCfg.match(/^ {2}- name: "/gm) ?? []).length === 0);
check('空池分组回退到 DIRECT', emptyCfg.includes('- DIRECT'));
check('空池 proxies 为 []', emptyCfg.includes('proxies:\n  []'));

/* ------------------------------------------------------------------ */
/* 5. 源清单完整性                                                     */
/* ------------------------------------------------------------------ */

section('5. 源清单完整性');

const keys = SOURCES.map((s) => s.key);
check('源 key 无重复', new Set(keys).size === keys.length, `共 ${keys.length} 个`);
check('至少有一个启用源', SOURCES.some((s) => !s.disabled));
check('每个源都有 urls', SOURCES.every((s) => s.urls.length > 0), keys.filter((k, i) => SOURCES[i].urls.length === 0).join(','));
check('每个源都有展示名', SOURCES.every((s) => s.name.length > 0));
check(
  '禁用的源都写明了原因',
  SOURCES.filter((s) => s.disabled).every((s) => (s.note ?? '').trim().length > 0),
  SOURCES.filter((s) => s.disabled && !(s.note ?? '').trim()).map((s) => s.key).join(','),
);
const ghSources = SOURCES.filter((s) => s.urls.some((u) => u.includes('raw.githubusercontent.com')));
check('GitHub 源已扩展镜像线路', ghSources.length > 0 && ghSources.every((s) => s.mirrors === true && s.urls.length > 1));
check(
  '镜像源单次超时已压低',
  ghSources.every((s) => (s.timeoutMs ?? 99999) <= 10000),
  ghSources.map((s) => `${s.key}=${s.timeoutMs}`).join(','),
);
check('无未知协议', SOURCES.every((s) => ['http', 'https', 'socks4', 'socks5'].includes(s.protocol)));

/* ------------------------------------------------------------------ */

process.stdout.write(`\n${'─'.repeat(48)}\n`);
process.stdout.write(`通过 ${passed} 项，失败 ${failed} 项\n`);
if (failed > 0) {
  process.exitCode = 1;
}
