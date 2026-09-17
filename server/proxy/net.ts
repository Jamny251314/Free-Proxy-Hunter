/**
 * 代理网络层
 * ------------------------------------------------------------
 * 提供三类能力：
 *  1. TCP / TLS 建连（带超时）
 *  2. 通过 HTTP(S) 代理或 SOCKS4/5 代理建立隧道
 *  3. 经由代理发起 HTTP 请求并测量延迟
 *
 * 仅依赖 Node 内置模块，无需任何第三方代理库。
 */

import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';
import type { Anonymity, ProbeOutcome, ProxyProtocol } from './types.js';

export interface ProxyEndpoint {
  host: string;
  port: number;
  protocol: ProxyProtocol;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/* ------------------------------------------------------------------ */
/* 字节流读取器：按需读取定长数据，用于 SOCKS 握手                      */
/* ------------------------------------------------------------------ */

class ByteReader {
  private buf: Buffer = Buffer.alloc(0);
  private waiters: Array<{
    n: number;
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
  }> = [];
  private ended = false;
  private failure: Error | null = null;

  constructor(socket: net.Socket) {
    socket.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.pump();
    });
    socket.on('end', () => {
      this.ended = true;
      this.pump();
    });
    socket.on('close', () => {
      this.ended = true;
      this.pump();
    });
    socket.on('error', (e: Error) => {
      this.failure = e;
      this.pump();
    });
  }

  private pump(): void {
    while (this.waiters.length > 0) {
      const w = this.waiters[0];
      if (this.buf.length >= w.n) {
        this.waiters.shift();
        const out = Buffer.from(this.buf.subarray(0, w.n));
        this.buf = this.buf.subarray(w.n);
        w.resolve(out);
      } else if (this.failure) {
        this.waiters.shift();
        w.reject(this.failure);
      } else if (this.ended) {
        this.waiters.shift();
        w.reject(new Error('连接被对端关闭'));
      } else {
        break;
      }
    }
  }

  read(n: number): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      this.waiters.push({ n, resolve, reject });
      this.pump();
    });
  }

  /** 读取 1 字节并解释为整数 */
  async readByte(): Promise<number> {
    const b = await this.read(1);
    return b[0];
  }
}

/* ------------------------------------------------------------------ */
/* 基础连接                                                            */
/* ------------------------------------------------------------------ */

export function connectTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('连接超时'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    });
  });
}

function upgradeTls(
  socket: net.Socket,
  servername: string,
  timeoutMs: number,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket,
      servername,
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
    });
    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(new Error('TLS 握手超时'));
    }, timeoutMs);
    tlsSocket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(tlsSocket);
    });
    tlsSocket.once('error', (err: Error) => {
      clearTimeout(timer);
      tlsSocket.destroy();
      reject(err);
    });
  });
}

/* ------------------------------------------------------------------ */
/* SOCKS 握手                                                          */
/* ------------------------------------------------------------------ */

async function socks5Tunnel(
  socket: net.Socket,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  const reader = new ByteReader(socket);

  // 协商：仅支持「无认证」
  socket.write(Buffer.from([0x05, 0x01, 0x00]));
  const greeting = await withTimeout(reader.read(2), timeoutMs, 'SOCKS5 协商超时');
  if (greeting[0] !== 0x05) throw new Error('SOCKS5 版本不匹配');
  if (greeting[1] !== 0x00) throw new Error('SOCKS5 需要认证（不支持）');

  // 连接请求：优先使用域名（支持上游 DNS 解析）
  const hostBuf = Buffer.from(host, 'utf8');
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port, 0);
  const req =
    hostBuf.length <= 255
      ? Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf])
      : concatIpv4Request(host, port);

  socket.write(req);
  const resp = await withTimeout(reader.read(4), timeoutMs, 'SOCKS5 连接超时');
  if (resp[0] !== 0x05) throw new Error('SOCKS5 响应异常');
  if (resp[1] !== 0x00) throw new Error(`SOCKS5 连接被拒绝 (rep=${resp[1]})`);

  // 消费掉 BND.ADDR / BND.PORT
  const atyp = resp[3];
  if (atyp === 0x01) {
    await reader.read(4 + 2);
  } else if (atyp === 0x03) {
    const len = await reader.readByte();
    await reader.read(len + 2);
  } else if (atyp === 0x04) {
    await reader.read(16 + 2);
  }
}

function concatIpv4Request(host: string, port: number): Buffer {
  const parts = host.split('.').map((p) => Number(p) & 0xff);
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port, 0);
  return Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x01, parts[0], parts[1], parts[2], parts[3]]),
    portBuf,
  ]);
}

async function socks4Tunnel(
  socket: net.Socket,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  const reader = new ByteReader(socket);
  const parts = host.split('.').map((p) => Number(p) & 0xff);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
    throw new Error('SOCKS4 仅支持 IPv4 目标');
  }
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port, 0);
  // VN=4, CD=1(CONNECT), DSTPORT, DSTIP, USERID(empty), NULL
  const req = Buffer.concat([
    Buffer.from([0x04, 0x01]),
    portBuf,
    Buffer.from(parts),
    Buffer.from([0x00]),
  ]);
  socket.write(req);
  const resp = await withTimeout(reader.read(8), timeoutMs, 'SOCKS4 连接超时');
  if (resp[1] !== 0x5a) throw new Error(`SOCKS4 连接被拒绝 (code=${resp[1]})`);
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/* 隧道建立                                                            */
/* ------------------------------------------------------------------ */

/** 通过代理与目标 host:port 建立可用隧道，返回可读写的 socket */
async function openTunnel(
  proxy: ProxyEndpoint,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket | tls.TLSSocket> {
  let socket: net.Socket | tls.TLSSocket = await connectTcp(proxy.host, proxy.port, timeoutMs);

  // 代理本身走 TLS（https 类型代理）
  if (proxy.protocol === 'https') {
    socket = await upgradeTls(socket as net.Socket, proxy.host, timeoutMs);
  }

  if (proxy.protocol === 'socks5') {
    await socks5Tunnel(socket as net.Socket, host, port, timeoutMs);
    return socket;
  }

  if (proxy.protocol === 'socks4') {
    await socks4Tunnel(socket as net.Socket, host, port, timeoutMs);
    return socket;
  }

  // HTTP / HTTPS 代理：CONNECT 隧道
  const reader = new ByteReader(socket as net.Socket);
  const connectReq =
    `CONNECT ${host}:${port} HTTP/1.1\r\n` +
    `Host: ${host}:${port}\r\n` +
    `User-Agent: ${UA}\r\n` +
    `Proxy-Connection: keep-alive\r\n\r\n`;
  (socket as net.Socket).write(connectReq);

  const head = await withTimeout(
    readHttpHead(reader),
    timeoutMs,
    'CONNECT 隧道建立超时',
  );
  const m = /^HTTP\/1\.[01]\s+(\d{3})/.exec(head);
  if (!m) throw new Error('CONNECT 响应无法解析');
  const code = Number(m[1]);
  if (code !== 200) throw new Error(`CONNECT 被拒绝 (HTTP ${code})`);
  return socket;
}

async function readHttpHead(reader: ByteReader): Promise<string> {
  // 逐字节读取直到出现 \r\n\r\n（ByteReader 内部已缓冲，不会频繁 syscall）
  let acc = '';
  for (let i = 0; i < 16384; i++) {
    const chunk = await reader.read(1);
    acc += chunk.toString('latin1');
    if (acc.endsWith('\r\n\r\n')) return acc;
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/* 经由代理的 HTTP 请求                                                */
/* ------------------------------------------------------------------ */

export interface RawResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  raw: string;
}

/**
 * 通过代理请求一个 **HTTP**（非 HTTPS）地址。
 * 返回完整响应与「首字节到达」延迟。
 */
export async function httpViaProxy(
  proxy: ProxyEndpoint,
  targetUrl: string,
  timeoutMs: number,
): Promise<{ response: RawResponse; latencyMs: number }> {
  const url = new URL(targetUrl);
  if (url.protocol !== 'http:') {
    throw new Error('httpViaProxy 仅支持 http:// 目标');
  }
  const host = url.hostname;
  const port = url.port ? Number(url.port) : 80;
  const path = `${url.pathname}${url.search}` || '/';

  const started = Date.now();
  let socket: net.Socket | tls.TLSSocket;
  let requestLine: string;

  if (proxy.protocol === 'http' || proxy.protocol === 'https') {
    // 经典 HTTP 代理用法：absolute-form 请求行，兼容性最好
    // （大量免费代理只允许 CONNECT 到 443，因此 HTTP 目标不走隧道）
    socket = await connectTcp(proxy.host, proxy.port, timeoutMs);
    if (proxy.protocol === 'https') {
      socket = await upgradeTls(socket as net.Socket, proxy.host, timeoutMs);
    }
    requestLine = `GET ${targetUrl} HTTP/1.1`;
  } else {
    // SOCKS：握手后使用 origin-form
    socket = await openTunnel(proxy, host, port, timeoutMs);
    requestLine = `GET ${path} HTTP/1.1`;
  }

  socket.write(
    `${requestLine}\r\n` +
      `Host: ${url.host}\r\n` +
      `User-Agent: ${UA}\r\n` +
      `Accept: */*\r\n` +
      `Accept-Encoding: identity\r\n` +
      `Proxy-Connection: close\r\n` +
      `Connection: close\r\n\r\n`,
  );

  return collectResponse(socket, started, timeoutMs);
}

/**
 * 通过代理请求一个 **HTTPS** 地址（CONNECT + TLS）。
 */
export async function httpsViaProxy(
  proxy: ProxyEndpoint,
  targetUrl: string,
  timeoutMs: number,
): Promise<{ response: RawResponse; latencyMs: number }> {
  const url = new URL(targetUrl);
  if (url.protocol !== 'https:') {
    throw new Error('httpsViaProxy 仅支持 https:// 目标');
  }
  const host = url.hostname;
  const port = url.port ? Number(url.port) : 443;
  const path = `${url.pathname}${url.search}` || '/';

  const started = Date.now();
  const tunnel = await openTunnel(proxy, host, port, timeoutMs);
  const secure = await upgradeTls(tunnel as net.Socket, host, timeoutMs);

  secure.write(
    `GET ${path} HTTP/1.1\r\n` +
      `Host: ${url.host}\r\n` +
      `User-Agent: ${UA}\r\n` +
      `Accept: */*\r\n` +
      `Accept-Encoding: identity\r\n` +
      `Connection: close\r\n\r\n`,
  );

  return collectResponse(secure, started, timeoutMs);
}

/** 读取响应直到连接关闭，并记录首字节延迟 */
function collectResponse(
  socket: net.Socket | tls.TLSSocket,
  startedAt: number,
  timeoutMs: number,
): Promise<{ response: RawResponse; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let firstByteAt = 0;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners('data');
      socket.destroy();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error('响应超时')));
    }, timeoutMs);

    socket.on('data', (chunk: Buffer) => {
      if (firstByteAt === 0) firstByteAt = Date.now();
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 512 * 1024) {
        finish(() => parseAndResolve());
      }
    });

    const parseAndResolve = () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({
        response: parseRawResponse(raw),
        latencyMs: Math.max(1, firstByteAt - startedAt),
      });
    };

    const done = () => {
      if (chunks.length === 0) {
        finish(() => reject(new Error('连接已关闭且无响应数据')));
        return;
      }
      finish(parseAndResolve);
    };

    socket.on('end', done);
    socket.on('close', done);
    socket.on('error', (err: Error) => {
      if (chunks.length > 0) {
        finish(parseAndResolve);
      } else {
        finish(() => reject(err));
      }
    });
  });
}

function parseRawResponse(raw: string): RawResponse {
  const idx = raw.indexOf('\r\n\r\n');
  const head = idx >= 0 ? raw.slice(0, idx) : raw;
  let body = idx >= 0 ? raw.slice(idx + 4) : '';
  const lines = head.split('\r\n');
  const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})/.exec(lines[0] || '');
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) {
      headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  if ((headers['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
    body = decodeChunked(body);
  }
  // 部分代理会错误地同时返回压缩内容，做一次容错剥离
  if (!body.startsWith('{') && !body.startsWith('[') && body.includes('\u0000')) {
    body = body.replace(/\u0000/g, '');
  }
  return {
    statusCode: statusMatch ? Number(statusMatch[1]) : 0,
    headers,
    body,
    raw,
  };
}

/** 极简 chunked 解码，保证 JSON 类回显目标能被正确解析 */
function decodeChunked(body: string): string {
  let out = '';
  let rest = body;
  for (let guard = 0; guard < 4096; guard++) {
    const nl = rest.indexOf('\r\n');
    if (nl < 0) break;
    const size = parseInt(rest.slice(0, nl).split(';')[0].trim(), 16);
    if (!Number.isFinite(size) || size < 0) break;
    if (size === 0) break;
    out += rest.slice(nl + 2, nl + 2 + size);
    rest = rest.slice(nl + 2 + size + 2);
  }
  return out || body;
}

/* ------------------------------------------------------------------ */
/* 探测目标与解析器                                                     */
/* ------------------------------------------------------------------ */

export interface ProbeTarget {
  url: string;
  /** 判定存活的状态码集合；为空表示任意 < 400 */
  accept?: number[];
  /** 解析出口 IP / 地理位置 / ISP */
  parse: (res: RawResponse) => Partial<ProbeOutcome>;
  /**
   * 二次校验响应确实来自该目标。
   * 必要性：普通 Web 服务器收到 absolute-form 请求行（`GET http://x/ HTTP/1.1`）
   * 会忽略绝对 URI 并返回自己的页面 + 200，若不做内容校验就会产生「假存活」。
   */
  verify?: (res: RawResponse) => boolean;
  /** 必须解析出合法的公网出口 IP 才算探测成功 */
  requireIp?: boolean;
}

/**
 * 判断是否为「可用作出口」的公网 IP。
 * 排除内网 / 环回 / 链路本地 / CGNAT / 保留段 —— 这些出现在出口位置说明响应是伪造或中间设备产生的。
 */
export function isPublicIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false; // 链路本地
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // 基准测试段
  if (a >= 224) return false; // 组播 / 保留
  return true;
}

/** 从响应体中抽取第一个 IP（用于纯回显类目标） */
function firstIp(body: string): string | undefined {
  const m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(body);
  return m?.[1];
}

/** 响应体是否「干净」——不含 HTML 结构，排除站点用自家页面冒充回显的情况 */
function looksLikePlainEcho(res: RawResponse): boolean {
  const body = res.body.trim();
  if (/<html|<!doctype|<\?xml|<head|<body|<script/i.test(body)) return false;
  return /^\s*[\d.a-fA-F:\s]{4,64}\s*$/.test(body) || body.length === 0;
}

/** 解析 ip-api.com 的 JSON 返回 */
function parseIpApi(res: RawResponse): Partial<ProbeOutcome> {
  try {
    const data = JSON.parse(res.body) as {
      status?: string;
      query?: string;
      country?: string;
      countryCode?: string;
      regionName?: string;
      city?: string;
      isp?: string;
    };
    if (!data.query) return {};
    return {
      exitIp: data.query,
      country: data.country,
      countryCode: data.countryCode,
      region: data.regionName,
      city: data.city,
      isp: data.isp,
    };
  } catch {
    return {};
  }
}

/** 解析纯 IP 文本（ip.3322.net 等） */
function parsePlainIp(res: RawResponse): Partial<ProbeOutcome> {
  const ip = firstIp(res.body);
  return ip ? { exitIp: ip } : {};
}

/**
 * 解析 ipip.net 的文本回显：
 *   `当前 IP：58.222.237.66 来自于：中国 江苏 泰州 电信`
 * 一份响应同时给出出口 IP + 国家/省/市/运营商，是当前网络环境下最理想的探测目标。
 */
function parseIpip(res: RawResponse): Partial<ProbeOutcome> {
  const body = res.body.replace(/\s+/g, ' ').trim();
  const ip = /IP\s*[：:]\s*([\d.]+)/i.exec(body)?.[1] ?? firstIp(body);
  const out: Partial<ProbeOutcome> = {};
  if (ip) out.exitIp = ip;

  const geo = /来自于\s*[：:]\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*(\S*)/.exec(body);
  if (geo) {
    const [, countryRaw, regionRaw, cityRaw, ispRaw] = geo;
    out.country = countryRaw;
    out.countryCode = countryCodeOf(countryRaw);
    out.region = regionRaw;
    out.city = cityRaw;
    if (ispRaw) out.isp = ispRaw;
  } else {
    const countryOnly = /来自于\s*[：:]\s*([^\s]+)\s*$/.exec(body)?.[1];
    if (countryOnly) {
      out.country = countryOnly;
      out.countryCode = countryCodeOf(countryOnly);
    }
  }
  return out;
}

/**
 * 把一段 HTML 归一化成「按行组织的纯文本」。
 * 用于解析以 HTML 页面承载、但信息区是纯文本的目标（典型是 cip.cc）。
 * 关键点：只把标签替换成空格，保留原有换行 —— 行首锚点才能成为可靠的定位依据。
 */
function textLines(body: string): string {
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '');
}

/**
 * 解析 cip.cc 的回显。响应虽是 HTML 页面，但信息区为纯文本：
 *   IP      : 183.215.23.242
 *   地址    : 中国 湖南 娄底
 *   运营商  : 移动
 * 一次给全出口 IP + 国家/省/市/运营商。
 *
 * 为什么值得专门适配：ipip 走代理时会返回 301（客户端不跟随跳转），
 * 此时若无第二个「信息丰富」的目标，探测就只能退到只回显 IP 的 3322，
 * 导致节点有出口 IP 却没有国家/城市/ISP —— 地区列全是空的。
 */
function parseCip(res: RawResponse): Partial<ProbeOutcome> {
  const text = textLines(res.body);
  const out: Partial<ProbeOutcome> = {};

  const ip = /(?:^|\n)\s*IP\s*[：:]\s*(\d{1,3}(?:\.\d{1,3}){3})/.exec(text)?.[1];
  if (ip) out.exitIp = ip;

  const geo = /(?:^|\n)\s*地址\s*[：:]\s*([^\n]*)/.exec(text)?.[1]?.trim();
  if (geo) {
    const parts = geo.split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      out.country = parts[0];
      // 「中国香港 / 中国台湾 / 中国澳门」可能被空格拆开，两种写法都试一遍
      out.countryCode = countryCodeOf(parts[0]) ?? countryCodeOf(parts.slice(0, 2).join(''));
    }
    if (parts.length > 1) out.region = parts[1];
    if (parts.length > 2) out.city = parts[2];
  }

  const isp = /(?:^|\n)\s*运营商\s*[：:]\s*([^\n]*)/.exec(text)?.[1]?.trim();
  if (isp) out.isp = isp;

  return out;
}

/** 常见国家/地区中文名 → ISO 代码（用于 Clash 节点国旗） */
const COUNTRY_CODES: Record<string, string> = {
  中国: 'CN', 香港: 'HK', 中国香港: 'HK', 澳门: 'MO', 中国澳门: 'MO', 台湾: 'TW', 中国台湾: 'TW',
  美国: 'US', 日本: 'JP', 韩国: 'KR', 新加坡: 'SG', 马来西亚: 'MY', 泰国: 'TH', 越南: 'VN',
  印度: 'IN', 印尼: 'ID', 菲律宾: 'PH', 德国: 'DE', 法国: 'FR', 英国: 'GB', 荷兰: 'NL',
  俄罗斯: 'RU', 加拿大: 'CA', 澳大利亚: 'AU', 巴西: 'BR', 土耳其: 'TR', 意大利: 'IT',
  西班牙: 'ES', 瑞典: 'SE', 瑞士: 'CH', 波兰: 'PL', 乌克兰: 'UA', 南非: 'ZA', 阿根廷: 'AR',
  墨西哥: 'MX', 沙特阿拉伯: 'SA', 阿联酋: 'AE', 以色列: 'IL', 埃及: 'EG', 巴基斯坦: 'PK',
  孟加拉国: 'BD', 尼泊尔: 'NP', 柬埔寨: 'KH', 缅甸: 'MM', 蒙古: 'MN', 哈萨克斯坦: 'KZ',
  爱尔兰: 'IE', 挪威: 'NO', 芬兰: 'FI', 丹麦: 'DK', 奥地利: 'AT', 比利时: 'BE', 捷克: 'CZ',
  罗马尼亚: 'RO', 匈牙利: 'HU', 希腊: 'GR', 葡萄牙: 'PT', 新西兰: 'NZ', 智利: 'CL',
};

function countryCodeOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return COUNTRY_CODES[name.trim()];
}

/** 解析 httpbin 的 /ip 返回 */
function parseHttpbinIp(res: RawResponse): Partial<ProbeOutcome> {
  try {
    const data = JSON.parse(res.body) as { origin?: string };
    if (!data.origin) return {};
    const ip = data.origin.split(',')[0].trim();
    return { exitIp: ip };
  } catch {
    return {};
  }
}

/**
 * 信息目标（同时给出出口 IP + 地理位置）。
 * 排序原则：本机实测可达性优先，其次信息丰富度。
 * 所有信息目标都带 requireIp —— 解析不出合法公网出口 IP 一律判为失败，
 * 这是消除「普通站点冒充代理」假阳性的核心。
 */
export const INFO_TARGETS: ProbeTarget[] = [
  {
    // 国内可达、单次返回 IP + 国家/省/市/运营商，本机实测 ~160ms
    url: 'http://myip.ipip.net/',
    parse: parseIpip,
    requireIp: true,
    verify: (res) => /IP\s*[：:]/i.test(res.body) && !/<html|<!doctype/i.test(res.body),
  },
  {
    url: 'https://myip.ipip.net/',
    parse: parseIpip,
    requireIp: true,
    verify: (res) => /IP\s*[：:]/i.test(res.body) && !/<html|<!doctype/i.test(res.body),
  },
  {
    // 第二顺位的信息目标：仍是 IP + 国家/省/市/运营商，用于 ipip 不可用（常见于
    // 走代理时被回 301）时兜住地理位置。响应是 HTML，因此校验必须锚定行首字段，
    // 否则任何「把请求主机名回显到跳转页」的站点都能冒充它。
    url: 'http://www.cip.cc/',
    parse: parseCip,
    requireIp: true,
    verify: (res) => {
      const text = textLines(res.body);
      return (
        /(?:^|\n)\s*IP\s*[：:]\s*\d{1,3}(?:\.\d{1,3}){3}/.test(text) &&
        /(?:^|\n)\s*地址\s*[：:]/.test(text)
      );
    },
  },
  {
    // 纯 IP 回显；必须响应体干净（不含 HTML），否则视为站点冒充
    url: 'http://ip.3322.net/',
    parse: parsePlainIp,
    requireIp: true,
    verify: looksLikePlainEcho,
  },
  {
    url: 'http://members.3322.org/dyndns/getip',
    parse: parsePlainIp,
    requireIp: true,
    verify: looksLikePlainEcho,
  },
  {
    // 境外环境可用，含 countryCode；当前网络不可达时自动跳过
    url: 'http://ip-api.com/json/?lang=zh-CN&fields=status,message,query,country,countryCode,regionName,city,isp',
    parse: parseIpApi,
    requireIp: true,
    verify: (res) => res.body.includes('"query"'),
  },
  {
    url: 'http://httpbin.org/ip',
    parse: parseHttpbinIp,
    requireIp: true,
    verify: (res) => res.body.includes('origin'),
  },
];

/**
 * 纯连通性目标（用于信息目标不可用时兜底）。
 * 排序原则：**能拿到出口 IP 的排前面** —— 这样即使主信息目标不可达，
 * 探测结果依然带出口 IP 与地区，并且能享受 requireIp 级别的严格校验。
 * 单纯「响应 200」的目标只能证明链路通，校验强度低得多，因此排在最后。
 * 每个目标都必须可验证 —— 普通站点返回自家 200 页面不会通过校验。
 *
 * 反例记录：曾经用 `http://www.baidu.com/` + 「正文含 baidu 字样」做兜底校验。
 * 这是错的，它被一台只会回**通用跳转页**的假代理骗过 —— 跳转页正文里
 * `<a HREF="https://www.baidu.com/">` 天然含有目标主机名，于是「正文含 baidu」
 * 恒为真。教训：校验依据不能是「请求主机名」，那正好是回显卡片的形状；
 * 必须锚定目标独有的、请求里不存在的内容（行首字段 / 纯 IP 正文 / 空正文 / 204）。
 */
export const PING_TARGETS: ProbeTarget[] = [
  {
    // 极小的纯 IP 回显，响应体只有十几字节，且必须「干净」（不含 HTML）
    url: 'http://ip.3322.net/',
    parse: parsePlainIp,
    requireIp: true,
    verify: looksLikePlainEcho,
  },
  {
    url: 'http://members.3322.org/dyndns/getip',
    parse: parsePlainIp,
    requireIp: true,
    verify: looksLikePlainEcho,
  },
  {
    // 同一个 cip.cc 也在信息目标里。这里保留它是为了让「纯连通性兜底」这一层
    // 也具备拿到出口 IP + 地区的能力 —— 校验强度同样是行首字段锚定。
    url: 'http://www.cip.cc/',
    parse: parseCip,
    requireIp: true,
    verify: (res) => {
      const text = textLines(res.body);
      return (
        /(?:^|\n)\s*IP\s*[：:]\s*\d{1,3}(?:\.\d{1,3}){3}/.test(text) &&
        /(?:^|\n)\s*地址\s*[：:]/.test(text)
      );
    },
  },
  {
    // 204 是强信号：普通站点不会对 GET 返回 204
    url: 'http://connectivitycheck.gstatic.com/generate_204',
    accept: [204],
    parse: () => ({}),
    verify: (res) => res.statusCode === 204,
  },
  {
    // /status/200 返回空体，站点冒充会带上自家页面
    url: 'http://httpbin.org/status/200',
    parse: () => ({}),
    verify: (res) => res.statusCode === 200 && res.body.trim().length === 0,
  },
];

/** 用直连方式测一个目标是否可用 */
export async function probeTargetDirect(
  target: ProbeTarget,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const res = await fetch(target.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity' },
    });
    if (target.accept && target.accept.length > 0) {
      return target.accept.includes(res.status);
    }
    if (res.status >= 400) return false;
    // 择优时同样做内容校验，避免选到一个「表面 200、实际返回无误导内容」的目标
    if (target.verify || target.requireIp) {
      const raw = await res.text();
      const probe: RawResponse = { statusCode: res.status, headers: {}, body: raw, raw };
      if (target.verify && !target.verify(probe)) return false;
      if (target.requireIp && !isPublicIp(target.parse(probe).exitIp)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** 本机公网 IP（用于匿名度判定） */
export async function getLocalPublicIp(timeoutMs = 8000): Promise<string | null> {
  for (const target of INFO_TARGETS) {
    try {
      const res = await fetch(target.url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity' },
      });
      const raw = await res.text();
      const parsed = target.parse({
        statusCode: res.status,
        headers: {},
        body: raw,
        raw,
      });
      if (parsed.exitIp) return parsed.exitIp;
    } catch {
      /* 尝试下一个 */
    }
  }
  return null;
}

/**
 * 依据响应头/响应体特征推断匿名度
 * - 出现 X-Forwarded-For / Via 泄露 → transparent
 * - 无泄露且出口 IP 等于代理自身 IP → anonymous
 * - 无泄露且出口 IP 与代理自身不同 → elite
 */
export function inferAnonymity(
  res: RawResponse,
  exitIp: string | undefined,
  proxyHost: string,
): Anonymity {
  const lower = res.raw.toLowerCase();
  const leaks =
    lower.includes('x-forwarded-for') ||
    lower.includes('x-real-ip') ||
    lower.includes('\nvia:') ||
    lower.includes('proxy-connection');
  if (leaks) return 'transparent';
  if (!exitIp) return 'unknown';
  return exitIp === proxyHost ? 'anonymous' : 'elite';
}
