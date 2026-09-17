#!/usr/bin/env node
/**
 * 代理猎手 CLI
 * ------------------------------------------------------------
 * 供 Agent（通过 Bash/Shell 工具）与用户命令行直接调用，
 * 与 Web 服务共享同一份 data/proxies.json。
 *
 * 用法:
 *   npx tsx server/cli.ts fetch  [--sources=ip89,kuaidaili]
 *   npx tsx server/cli.ts test   [--scope=unknown|all|alive|stale] [--concurrency=120] [--timeout=6000]
 *   npx tsx server/cli.ts sync
 *   npx tsx server/cli.ts export
 *   npx tsx server/cli.ts stats  [--limit=20]
 *   npx tsx server/cli.ts sources
 */

import { SOURCES } from './proxy/sources.js';
import { pool } from './proxy/store.js';
import {
  exportNow,
  progress,
  runFetch,
  runSync,
  runTest,
  snapshotProgress,
  targetStatus,
} from './proxy/engine.js';
import { dedupeForClash } from './proxy/clash.js';

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return fallback;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 终端显示宽度：CJK / 全角字符占 2 列，而 String.length 只算 1。
 * CLI 表格的列名（节点/地区/匿名度…）与「地区」取值都是中文，
 * 若用 .length 计算列宽，含中文的列会整体左移、后续列错位。
 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch)
      ? 2
      : 1;
  }
  return w;
}

/** 剥离 ANSI 颜色转义，避免把颜色字节算进列宽 */
const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

function renderTable(rows: Array<Record<string, unknown>>, columns: string[]): string {
  if (rows.length === 0) return '(空)';
  const widths = columns.map((c) =>
    Math.max(displayWidth(c), ...rows.map((r) => displayWidth(stripAnsi(String(r[c] ?? ''))))),
  );
  const line = (cells: string[]) =>
    cells.map((cell, i) => pad(cell, widths[i])).join('  ');
  const out = [line(columns), line(columns.map((c) => '-'.repeat(displayWidth(c))))];
  for (const r of rows) {
    out.push(line(columns.map((c) => String(r[c] ?? ''))));
  }
  return out.join('\n');
}

function pad(s: string, width: number): string {
  const diff = width - displayWidth(stripAnsi(s));
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'help';

  switch (cmd) {
    case 'fetch': {
      const keys = arg('sources');
      const explicit = !!keys;
      const list = explicit
        ? SOURCES.filter((s) => keys!.split(',').map((k) => k.trim()).includes(s.key))
        : SOURCES;
      if (list.length === 0) {
        process.stderr.write(`未匹配到代理源: ${keys}\n`);
        process.exit(1);
      }
      // 与 REST 接口保持一致：显式点名某个源时，连同默认停用的源一起抓，便于确认是否恢复
      const outcomes = await runFetch(list, { includeDisabled: explicit });
      printJson({
        sources: outcomes.length,
        totalFound: outcomes.reduce((a, b) => a + b.found, 0),
        totalAdded: outcomes.reduce((a, b) => a + b.added, 0),
        poolSize: pool.size(),
        detail: outcomes.map((o) => ({
          key: o.key,
          name: o.name,
          ok: o.ok,
          found: o.found,
          added: o.added,
          ms: o.ms,
          error: o.error,
        })),
      });
      break;
    }

    case 'test': {
      // --ids 优先于 --scope：用于定向复验个别节点（排查「这条到底还行不行」）
      const ids = arg('ids')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await runTest({
        scope: (arg('scope') as 'all' | 'unknown' | 'alive' | 'stale') ?? 'unknown',
        concurrency: arg('concurrency') ? Number(arg('concurrency')) : undefined,
        timeoutMs: arg('timeout') ? Number(arg('timeout')) : undefined,
        rounds: arg('rounds') ? Number(arg('rounds')) : undefined,
        ids,
      });
      printJson({ ...result, stats: pool.stats() });
      if (ids && ids.length > 0) {
        const rows = ids
          .map((id) => pool.get(id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .map((r) => ({
            节点: r.id,
            状态: r.status,
            延迟: r.latencyAvg ?? r.latency ?? '-',
            出口IP: r.exitIp ?? '-',
            地区: [r.country, r.region, r.city].filter(Boolean).join('/') || '-',
            ISP: r.isp ?? '-',
            匿名度: r.anonymity,
            失败原因: r.lastError ?? '-',
          }));
        process.stdout.write(`\n${renderTable(rows, ['节点', '状态', '延迟', '出口IP', '地区', 'ISP', '匿名度', '失败原因'])}\n`);
      }
      break;
    }

    case 'sync': {
      const result = await runSync();
      printJson({
        fetchedSources: result.sources.length,
        tested: result.tested,
        alive: result.alive,
        exported: result.exported,
        stats: pool.stats(),
      });
      break;
    }

    case 'export': {
      const result = exportNow();
      printJson({ ...result, nodes: dedupeForClash(pool.exportable()).length });
      break;
    }

    case 'stats': {
      const limit = Number(arg('limit') ?? '20');
      const stats = pool.stats();
      printJson({ stats, targets: targetStatus() });
      const rows = pool.list({ status: 'alive', limit }).map((r) => ({
        节点: `${r.host}:${r.port}`,
        协议: r.protocol,
        延迟: r.latencyAvg ?? r.latency ?? '-',
        '地区': [r.country, r.city].filter(Boolean).join('/') || '-',
        匿名度: r.anonymity,
        评分: r.score,
        成功率: `${r.success}/${r.success + r.fail}`,
      }));
      process.stdout.write(`\n${renderTable(rows, ['节点', '协议', '延迟', '地区', '匿名度', '评分', '成功率'])}\n`);
      break;
    }

    case 'sources': {
      const report = pool.sourceReport();
      // 停用源排在最后，方便先看可用源
      const ordered = [...SOURCES].sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled));
      const rows = ordered.map((s) => ({
        key: s.key,
        名称: s.name,
        协议: s.protocol,
        方式: s.mirrors ? `镜像×${s.urls.length}` : s.kind,
        页数: s.mirrors ? '-' : (s.pages ?? 1),
        上次发现: report[s.key]?.found ?? '-',
        新增: report[s.key]?.added ?? '-',
        状态: s.disabled ? '已停用' : report[s.key] ? (report[s.key].ok ? 'OK' : 'FAIL') : '未采集',
      }));
      process.stdout.write(
        `\n${renderTable(rows, ['key', '名称', '协议', '方式', '页数', '上次发现', '新增', '状态'])}\n`,
      );
      const disabled = ordered.filter((s) => s.disabled);
      if (disabled.length > 0) {
        process.stdout.write('\n已停用的源（含原因）：\n');
        for (const s of disabled) process.stdout.write(`  ${s.key.padEnd(18)} ${s.note ?? '—'}\n`);
      }
      process.stdout.write(
        `\n共 ${ordered.length} 个源，其中 ${ordered.length - disabled.length} 个参与默认采集。` +
          '可对停用源单独采集以确认是否恢复：npm run proxy:fetch -- --sources=<key>\n',
      );
      break;
    }

    default: {
      process.stdout.write(
        [
          '代理猎手 CLI',
          '',
          '可用命令:',
          '  fetch   全量或指定源采集        [--sources=key1,key2]',
          '  test    并发测速验证            [--scope=unknown|all|alive|stale] [--concurrency=120] [--timeout=6000] [--rounds=1] [--ids=url1,url2]',
          '                                    scope=unknown 默认，只测还没确认可用的；all 为整池复验；ids 定向复验指定节点',
          '  sync    采集 + 测速 + 整合导出',
          '  export  仅重新生成 Clash 配置',
          '  stats   查看池内可用节点        [--limit=20]',
          '  sources 查看代理源清单与采集结果',
          '',
        ].join('\n'),
      );
      break;
    }
  }
}

main()
  .catch((e: Error) => {
    process.stderr.write(`执行失败: ${e.message}\n`);
    if (progress.logs.length > 0) {
      process.stderr.write(`最近日志:\n${snapshotProgress().logs.map((l) => `  [${l.level}] ${l.text}`).join('\n')}\n`);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    // CLI 是一次性进程，确保数据落盘后退出
    pool.saveNow();
  });
