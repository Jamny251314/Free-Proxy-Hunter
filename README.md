# 免费代理猎手 · Free Proxy Hunter

一个基于 **CodeBuddy Agent SDK** 的 Agent Web 应用：全网抓取免费 IP 代理 → 实时测速验证 → 运行时持续同步源站免费库 → 整合去重 → 一键接入 **Clash Verge**。

- **Agent 对话**：内置「代理猎手」Agent，可以用自然语言驱动采集、测速、导出，并帮你扩展新的代理源
- **代理池控制台**：可视化的实时看板，支持筛选、排序、单条重测、批量淘汰
- **运行时自动更新**：可配置间隔，自动执行「采集 → 测速 → 整合 → 刷新配置」
- **Clash Verge 直连**：同时提供远程订阅地址、Proxy Provider 地址、可粘贴配置片段与本地文件

---

## 快速开始

### 1. 环境要求

- Node.js **20.12+**（推荐 20 / 22）—— 后端用 Node 内置的 `process.loadEnvFile()` 读取 `.env`，低于 20.12 会跳过加载并打印告警
- **不需要**单独安装 CodeBuddy CLI：`@tencent-ai/agent-sdk` 已内置 `cli/bin/codebuddy`，SDK 会自动定位（实测在 PATH 里没有任何全局 `codebuddy` 时同样可用）

### 2. 安装依赖

```bash
npm install
```

受限网络下的安装问题见文末「依赖安装提示」。

### 3. 配置鉴权

```bash
cp .env.example .env
```

编辑 `.env`，至少填入 `CODEBUDDY_API_KEY`（或 `CODEBUDDY_AUTH_TOKEN`）。
也可以启动后在页面「设置」里临时配置，但仅当前进程有效 —— **重启即失效**。

### 4. 启动

日常使用推荐**生产模式**：单端口、不用开前端 dev server。

```bash
npm run build      # 构建前端到 dist/
npm start          # 后端在 3000 一并托管 dist/，浏览器直接开 http://localhost:3000
```

改前端代码时用**开发模式**（热更新）：

```bash
npm run dev        # 后端 3000 + 前端 5173，浏览器开 http://localhost:5173
```

打开界面后，左侧导航进入 **免费代理池** → 点击 **一键同步**，即完成第一轮采集与测速。

---

## 运行方式

两种形态共用同一份后端、同一份 `data/` 数据，随时可以互相切换：

| | 开发模式 | 生产模式（单端口） |
| --- | --- | --- |
| 命令 | `npm run dev` | `npm run build` + `npm start` |
| 前端由谁提供 | Vite dev server（5173，热更新） | 后端托管 `dist/` |
| 后端 | `tsx watch`，改代码自动重启 | `tsx`，只启动一次 |
| 访问地址 | <http://localhost:5173> | <http://localhost:3000> |
| 跨域 | 由 Vite 把 `/api` 代理到后端 | 页面与 API 同源，不涉及 |
| 适合 | 改前端代码 | 日常使用 / 部署到服务器 |

### 开发模式

```bash
npm run dev
```

`dev` 交给 `concurrently` 同时拉起两个进程：

- `npm run dev:server` → `tsx watch server/index.ts`（后端，读 `PORT`，默认 3000）
- `npm run dev:client` → `vite`（前端，读 `VITE_PORT`，默认 5173）

前端发出的所有 `/api` 请求由 Vite 转发到后端，转发目标端口**跟随 `PORT`**，
所以改了 `.env` 里的端口不需要再手工改 `vite.config.ts`。只想跑其中一个：

```bash
npm run server     # 只跑后端（不监听文件变化）
npm run dev:server # 只跑后端（watch 模式）
npm run dev:client # 只跑前端，需要后端已在运行
```

### 生产模式（单端口）

```bash
npm run build      # tsc -b && vite build → 产出 dist/
npm start          # 等价于 npm run server
```

后端启动时会检查 `dist/index.html`：

- **存在** → 用 `express.static` 托管 `dist/`，并把所有非 `/api` 的 GET 请求回退到 `index.html`
  （前端路由刷新不会 404）。启动横幅显示 `前端: 已托管 dist/`。
- **不存在** → 跳过托管、只提供 API。此时直接访问 <http://localhost:3000> 看到 404 属预期行为，
  请改用 `npm run dev`。横幅会显示 `前端: 未构建（仅 API）`，一眼就能区分这两种状态。

几个已经处理好的细节：

- `/api` 被**显式排除**在 SPA 回退之外，写错的接口路径会得到明确的 **404**，
  而不是被吃成「200 + 一堆 HTML」。
- `index.html` 不做长缓存（静态托管传了 `index: false`），带 hash 的静态资源缓存 1 小时，
  前端重新发布后不会拿到旧页面。
- `data/` 不存在时自动创建；数据路径按**源码所在目录**解析而不是当前工作目录，
  从任何目录执行 `npm start` 都能找到数据文件。

### 配置从哪里来

三种方式，优先级从高到低：

1. **真实环境变量** —— systemd 的 `Environment=`、Docker 的 `-e`、pm2 的 `env`、shell 里 `export`。
   生产环境推荐这种，密钥不落盘。
2. **项目根目录的 `.env`** —— 启动时由 `process.loadEnvFile()` 读取。
   若同名变量已被真实环境变量设置过，**`.env` 不会覆盖它**。
3. **页面「设置」** —— 调 `/api/save-env-config` 写进当前进程，**重启即失效**，只适合临时补配。

`.env` 的路径固定在项目根（`server/index.ts` 的上一级），与你在哪个目录启动无关。

代理引擎的三个变量是**例外**：`PROXY_CONCURRENCY` / `PROXY_TIMEOUT_MS` / `PROXY_MAX_FAIL`
只在首次启动、还没有 `data/proxy-config.json` 时作为初始值。一旦在页面「引擎设置」里改过任何一项，
配置文件就生成了，之后一律以文件为准 —— 想强制重置就删掉该文件再重启。

---

## 部署到服务器

> ⚠️ **先读这一条**：本项目**没有任何鉴权**。所有接口（包括会调用 CodeBuddy API 的 `/api/chat`）
> 对访问者完全开放，谁打开页面谁就能用你的 API Key 跑对话、改配置、清空代理池。
> **不要**把 3000 端口直接暴露到公网。请按下面「加上访问保护」放一层反向代理 + 认证，或只在内网使用。

### 需要准备什么

- 一台能访问 npm 源和 CodeBuddy API 的服务器（Linux 推荐，Windows 亦可）
- Node.js 20.12+（推荐 22）
- 不需要装 CodeBuddy CLI，有 `CODEBUDDY_API_KEY` 即可

### 1. 上传代码

用 git 或直接拷目录。注意三点：**不要带 `node_modules`**，**不要带 `.env`**，**不要带 `data/`**。
仓库里的 `.gitignore` 已经把这三类排除了。

```bash
# 方式一：git
git clone <你的仓库地址> proxy-hunter-agent

# 方式二：本地打包上传（排除上面三类）
tar -czf proxy-hunter.tgz \
    --exclude=node_modules --exclude=data --exclude=dist --exclude='.env' \
    -C /path/to proxy-hunter-agent
```

> Windows 上用 Git Bash 打包时给 `tar` 再加 `--force-local`，否则路径里的盘符（`C:`）
> 会被当成远程主机名，报 `Cannot connect to C: resolve failed`。

### 2. 安装依赖

```bash
cd proxy-hunter-agent
npm ci --omit=dev
```

- `tsx` 已列在 `dependencies`，所以 `--omit=dev` 之后照样能启动。
- `better-sqlite3` 是可选依赖，装不上会自动降级成 JSON 存储，功能不受影响。
- **若卡在安装脚本阶段**（下载阶段很快就完成、之后长时间不动），加 `--ignore-scripts` 跳过，
  受限网络下这是常见情况，见文末「依赖安装提示」。

### 3. 构建前端

`vite` 和 `typescript` 在 `devDependencies` 里，`--omit=dev` 装不到，所以二选一：

- **方案 A（推荐）**：在开发机上跑 `npm run build`，把生成的 `dist/` 一并上传。
  `dist/` 只是静态文件，不存在平台差异。
- **方案 B**：在服务器上装全量依赖构建一次。

  ```bash
  npm install          # 受限网络下：npm install --ignore-scripts --registry=https://mirrors.cloud.tencent.com/npm/
  npm run build
  npm prune --omit=dev # 构建完再裁掉 dev 依赖（可选）
  ```

### 4. 注入配置

不想把密钥写进文件就用真实环境变量：

```bash
export PORT=3000
export CODEBUDDY_API_KEY=sk-xxxxxxxx
# export CODEBUDDY_AUTH_TOKEN=...         # 或改用登录态 Token
# export CODEBUDDY_INTERNET_ENVIRONMENT=  # 内网 / 私有化环境才填
# export CODEBUDDY_BASE_URL=              # 自定义网关，留空用官方
npm start
```

更习惯文件方式的话：`cp .env.example .env` 后填值，效果相同。

### 5. 挂到进程管理器

```bash
npm start                          # 前台试跑，Ctrl+C 即停（仅用于验证）
```

用 **pm2**：

```bash
npm i -g pm2
pm2 start "npm start" --name proxy-hunter
pm2 save && pm2 startup
```

或用 **systemd**，写 `/etc/systemd/system/proxy-hunter.service`
（把 `User` / `WorkingDirectory` / 密钥换成实际值）：

```ini
[Unit]
Description=Free Proxy Hunter Agent
After=network-online.target

[Service]
Type=simple
User=appuser
WorkingDirectory=/opt/proxy-hunter-agent
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=CODEBUDDY_API_KEY=sk-xxxxxxxx
ExecStart=/usr/bin/node /opt/proxy-hunter-agent/node_modules/tsx/dist/cli.mjs server/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`ExecStart` 直接写 `node + tsx` 而不是 `npm start`，是为了少一层 npm 进程，
让 systemd 能正确判断存活、干净地重启。

### 6. 目录权限

运行用户需要对项目根下的 **`data/`** 有写权限 —— 代理池、引擎配置、Clash 产物、会话记录都写在这里：

```bash
mkdir -p data && chown -R appuser:appuser data
```

### 7. 验证

```bash
curl -s  http://127.0.0.1:3000/api/health                          # {"status":"ok",...}
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/      # 200（前端页面）
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/nope   # 404（不是 HTML）
```

再对照一下启动横幅：它会打印实际端口、前端是否已托管、当前数据库驱动、代理池规模，
不用猜也能确认状态对不对。

### 加上访问保护

后端已经同时提供页面和 API，所以反向代理**只需要一路转发**，认证加在代理层即可。

**Nginx** 示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 基础认证：先生成密码文件
    #   printf "admin:%s\n" "$(openssl passwd -apr1 '你的密码')" > /etc/nginx/.htpasswd
    auth_basic           "Proxy Hunter";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # /api/chat 与 /api/proxy/stream 是 SSE 长连接：
        # 必须关掉缓冲、放宽超时，否则对话会一直转圈不出字
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

两处最容易踩的坑：

- **必须 `proxy_buffering off`**。页面有两条 SSE 流（Agent 对话、代理池实时日志），
  Nginx 默认会把响应攒起来再发，表现是「请求已经发出去，但前端一直没有增量输出」。
- **`auth_basic` 必须覆盖 `/api`**。只保护页面没有意义 —— 接口是完全开放的，
  绕过前端直接 `curl` 就能调用。

**HTTPS** 直接接 certbot 即可，不需要改后端：应用不写死协议，同源请求会跟随页面协议。

也可以让 Nginx 直接托管 `dist/`、只把 `/api` 转发到 3000（标准 SPA + `try_files $uri /index.html`）。
功能一致，本项目默认用前一种，少一份配置。

### 容器化

本机没有 Docker 环境，所以**没有提供未经验证的 Dockerfile**。若要在容器里跑，注意：

- 镜像里需要 `dist/`。可用多阶段构建：先 `npm ci` 装全量依赖 + `npm run build`，
  再 `npm ci --omit=dev` 并拷入 `dist/`。
- **`data/` 必须挂成 volume**，否则重建容器会丢掉整池代理和会话记录。
- 容器化**不能**替代认证：把端口映射到宿主机时，仍然是「谁访问谁就能用你的 API Key」。

### 部署相关变量一览

| 变量 | 默认 | 作用 | 备注 |
| --- | --- | --- | --- |
| `PORT` | 3000 | 后端端口 | 生产只需要这一个端口 |
| `CODEBUDDY_API_KEY` | 空 | API Key 鉴权 | 与 `CODEBUDDY_AUTH_TOKEN` 二选一 |
| `CODEBUDDY_AUTH_TOKEN` | 空 | 登录态 Token 鉴权 | |
| `CODEBUDDY_INTERNET_ENVIRONMENT` | 空 | 内网 / 私有化环境标识 | 公网环境留空 |
| `CODEBUDDY_BASE_URL` | 空 | 自定义 API 网关 | 留空用官方默认 |
| `PROXY_CONCURRENCY` | 120 | 测速并发数 | 仅首次启动的默认值，见上文 |
| `PROXY_TIMEOUT_MS` | 6000 | 单条探测超时（毫秒） | 同上 |
| `PROXY_MAX_FAIL` | 3 | 连续失败几次判失效 | 同上 |
| `VITE_PORT` | 5173 | 前端开发端口 | 仅 `npm run dev` 用到 |

---

## 功能说明

### 代理池控制台

| 区域 | 能力 |
| --- | --- |
| 统计卡片 | 池内总量、可用数量与可用率、平均延迟、最快节点、失效/待测、最近同步时间 |
| 实时日志 | SSE 推送采集中/测速中的实时进度与逐源结果 |
| 引擎设置 | 自动更新开关与间隔、测速并发、超时、淘汰阈值、导出评分线与数量上限、地区解析与匿名度判定 |
| 操作按钮 | 一键同步 / 仅抓取更新 / 仅测速验证 / 重新导出 / 清空池 |
| 代理表格 | 按延迟与评分排序，按状态、协议、评分筛选，支持关键字搜索、单条重测、复制节点、删除 |
| 代理源 | 查看内置全部源、各源上次采集结果，可对单个源单独采集 |

### 引擎内部流程

```
┌─────────────┐   ┌────────────┐   ┌──────────────┐   ┌────────────┐
│  采集源站    │ → │ 去重合并入池 │ → │ 并发测速验证  │ → │ 评分整合淘汰 │
│  28 个源     │   │ 协议+IP+端口│   │ HTTP/SOCKS  │   │ 延迟/成功/新鲜│
└─────────────┘   └────────────┘   └──────────────┘   └────────────┘
                                                              ↓
                                                    ┌──────────────────┐
                                                    │ 导出 Clash 配置   │
                                                    │ 订阅 / Provider   │
                                                    └──────────────────┘
```

**采集源**覆盖三类：国内免费代理站（89IP、云代理、小幻 HTTP…）、公开代理 API（ProxyScrape、proxy-list.download、openproxy.space）、GitHub 高频维护仓库（TheSpeedX、monosans、proxifly、clarketm、jetkai、hookzof…）。完整清单见 `server/proxy/sources.ts`。

源清单按**实测结果**维护，而不是照抄站点列表：

- **多线路镜像竞速**：GitHub 类源自动展开为 8 条线路（raw 原站 + jsDelivr 的 CDN/fastly/gcore + gitmirror + ghproxy/gh-proxy/ghfast），
  采集时并发竞速，谁先返回用谁，其余请求立即中断。单一线路被墙不会导致整个源采不到数据。
- **分页串行**：同一站点的多个分页改为串行抓取、页间留 350ms 间隔。
  并发拉取同一站点的多个分页会被判定为爬虫，从而返回空表 —— 这正是「HTTP 200 但 0 条代理」的常见原因。
- **连空两页即止**：翻到尾部后不再继续请求，省掉无意义的空页等待。
- **失效源直接标注停用**：实测打不通或需要 JS 挑战的源（快代理的 EdgeOne 机器人防护、站大爷 405、开心代理 Cookie 挑战、66IP 改版 404 等）
  在清单里 `disabled: true` 并写明原因，默认采集直接跳过；仍可在「代理源」面板点「单独采集」手动确认是否恢复。
  当前内置 28 个源，其中 22 个参与默认采集（准确数量以 `npm run proxy:sources` 的实时输出为准）。

**测速验证**在启动时自动从候选目标里择优，用直连方式确认可达后再作为回显目标，避免因目标站本身不可用导致全池误判。
候选顺序按「信息丰富度」排列：`myip.ipip.net`（一次返回出口 IP + 国家/省/市/运营商）→ `www.cip.cc`（同样是 IP + 地址 + 运营商）→
`ip.3322.net` 等纯回显 → `ip-api.com`（境外环境可用）。择优时会校验响应内容，不会被「表面 200」的站点骗到。

探测单个代理时**按顺序遍历全部信息目标 + 兜底目标**，命中第一个即止：

- 多留一个信息丰富目标，是为了兜住「`myip.ipip.net` 走代理被回 301」这种情况 ——
  只试一个目标的话，探测会直接退到只回显 IP 的 `ip.3322.net`，节点就有出口 IP 却查不到地区。
  目标列表按信息丰富度排序，可用代理通常在第一个目标就命中，因此不会明显变慢。
- 单节点还有**总时间预算**（默认超时的 2.5 倍）：一个所有目标都超时的死节点不会把 8 个目标的
  超时时间全额耗光。可用代理在前 1~2 个目标就命中，所以这个上限只对死节点生效。
- 关闭「地区解析」后，专为补地区而设的信息目标会被跳过，每节点省掉一轮请求。

`GET /api/proxy/targets` 返回的目标信息里，四个字段各司其职，**别混用**：

| 字段 | 含义 | 什么时候看它 |
| --- | --- | --- |
| `info` | 实际尝试顺序里的第一个**信息**目标 —— 真正定义「延迟口径」的那个 | 解释全池延迟数值怎么来的 |
| `attempts` | 实际会依序尝试的**完整**目标列表 | 想知道某一轮到底试了哪几个 |
| `reachable` | 启动时**直连实测**确认可用的目标（`info` / `ping` 两项） | **判断「回显目标是否可达」只看这里** |
| `ping` | **静态列表**里第一个纯连通性目标 | 参考用。它未必在本机可达 |

`ping` 是最容易误读的一个：它指向静态列表尾部的纯连通性目标（`connectivitycheck.gstatic.com/generate_204`），
而该站点在境内网络常年打不通；`ip.3322.net`、`www.cip.cc` 虽然同样是纯 IP 回显，却因为也登记在信息目标里、
不会被算作 `ping`。所以「全池可用数突然为 0」时要核对的是 `reachable`，拿 `ping` 去判断会得出错误结论。

每个目标都带**严格校验**，这是区分「真代理」与「假存活」的关键：

- 信息类目标必须解析出合法的**公网**出口 IP，否则判为失败（内网 / 环回 / 链路本地 / CGNAT 一律拒绝）。
- 响应内容必须与目标相符。普通 Web 服务器收到 `GET http://x/ HTTP/1.1` 这种 absolute-form 请求行时，
  会忽略绝对 URI 并返回自己的页面 + 200 —— 不做内容校验就会把一堆普通网站当成可用代理。
- **3xx 一律判失败，不跟跳转**。所有探测目标都直接返回 200，链路正常的代理不会产生需要跟随的跳转；
  而「把请求主机名回显到通用跳转页」正是假存活最典型的形状：跳转页正文里的
  `<a HREF="https://<请求主机>/">` 天然含有目标主机名，会让任何「正文是否含目标关键字」的弱校验恒为真。
  这条规则在引擎层统一掐断整类响应，不必指望每个目标的校验都写得足够严。
- 其余兜底目标同样可验证：`generate_204` 需真的是 204、`httpbin/status/200` 需空响应体、
  纯 IP 回显需正文干净（不含 HTML 结构）。`ip-api` 需响应含 `query` 字段。

同时会解析出口 IP、国家/城市、ISP、匿名度（透明/匿名/高匿）。

**评分模型**综合延迟（权重 50）、历史成功率（权重 30）、新鲜度（权重 20），
并对连续失败、透明代理做扣分，SOCKS5 与高匿节点加分。

### 接入 Clash Verge

推荐 **Proxy Provider** 方式，现有配置无需改动：

1. Clash Verge →「订阅」→ 新建 → 类型选 **Remote**，地址填：

   ```
   http://127.0.0.1:3000/api/proxy/clash.yaml
   ```

2. 或把本应用自动生成的 `data/clash-proxies.yaml` 拖入「订阅」页作为 **Local** 配置导入
3. 或在现有配置的「编辑文件」里粘贴 `/api/proxy/clash-snippet` 返回的 `proxy-providers` 片段，
   让免费池作为独立分组挂到你的配置里
4. 导入后在「代理」页把 **🚀 节点选择** 指向 **♻️ 自动选择**，Clash 会自动挑选最快节点

生成的配置包含 `url-test`（自动选择）、`fallback`（故障转移）、`select`（手动）三个分组，
以及 CN 直连规则与 DNS / fake-ip 设置。

### Agent 对话能做什么

- 「跑一轮，把可用的低延迟节点挑出来」→ 调用同步接口后给出结构化结果
- 「只看日本的 SOCKS5」→ 查询池并过滤
- 「帮我加上某某代理站」→ 阅读站点 → 修改 `sources.ts` → 验证采集
- 「为什么可用率这么低」→ 结合源报表、目标可达性、并发与超时设置给出诊断

Agent 的权威提示词定义在 `server/prompt.ts`，前端启动时通过 `/api/proxy/agent-prompt` 拉取，
保证前后端一致。项目内还放置了 `.codebuddy/skills/free-proxy-hunter/SKILL.md` 作为 Agent 的运维手册。

---

## 命令行

```bash
npm run proxy:fetch                  # 全量采集
npm run proxy:fetch -- --sources=ip3366
npm run proxy:test                   # 默认测「还没确认可用的」（从未测过 + 已判失效）
npm run proxy:test -- --scope=all --concurrency=200 --timeout=8000   # 整池复验
npm run proxy:test -- --ids=http://1.2.3.4:8080                     # 定向复验指定节点，输出出口 IP / 地区 / 失败原因
npm run proxy:sync                   # 采集 + 整池复验 + 整合导出
npm run proxy:export                 # 仅重新生成 Clash 配置
npm run proxy:stats                  # 表格展示池内可用节点
npm run proxy:sources                # 展示各源采集结果与停用原因
npm run proxy:selftest               # 离线自检（不联网）
```

CLI 与 Web 服务共享同一份 `data/proxies.json`，可以混用。

### 测速范围的语义

代理的 `status` 表示**最近一次检测的结论**，探测失败即标为失效（`dead`），
同时清除该条的出口 IP / 地理 / 匿名度；连续失败计数另行累计，只用于决定是否从池中彻底淘汰。
因此界面上显示的「可用数」就是最近一轮真实测通的节点数。

| scope | 含义 |
| --- | --- |
| `unknown`（默认） | 还没确认可用的：从未检测过的 + 已判失效的 |
| `all` | 整池复验（**「一键同步」走的就是这个**） |
| `alive` | 仅当前可用的（复检存活节点是否已掉线） |
| `stale` | 超过 10 分钟未检测的 |

被源站重新采集到的失效节点会自动获得一次复活机会（状态回到未验证），
所以每一轮「同步」都会把上一轮的失败项重新测一遍。

---

## 目录结构

```
proxy-hunter-agent/
├── server/
│   ├── index.ts              # Express + SSE + Agent SDK 接入 + .env 加载 + 生产静态托管
│   ├── prompt.ts             # 「代理猎手」Agent 权威提示词
│   ├── cli.ts                # 命令行入口
│   ├── db.ts                 # 会话与消息持久化（SQLite，装不上时自动降级 JSON）
│   └── proxy/
│       ├── types.ts          # 类型定义
│       ├── net.ts            # HTTP/SOCKS 隧道、代理请求、延迟测量
│       ├── sources.ts        # 代理源清单与解析器
│       ├── store.ts          # 代理池持久化、去重、评分、淘汰
│       ├── clash.ts          # Clash / Mihomo 配置生成
│       ├── engine.ts         # 采集 / 测速 / 同步 / 定时调度
│       └── routes.ts         # REST API + SSE
├── src/
│   ├── pages/ProxyPage.tsx   # 代理池控制台
│   ├── components/proxy/     # 统计卡片、表格、Clash 面板、设置、源清单、日志
│   ├── hooks/useProxyPool.ts # 代理池状态与 SSE 订阅
│   └── ...                   # 模板自带的聊天界面
├── dist/                     # npm run build 的产物；存在时由后端单端口一并托管
├── data/                     # 运行时数据（代理池、引擎配置、Clash 文件、会话记录），首次启动自动创建
├── .env.example              # 环境变量模板（可复制为 .env；真实环境变量优先级更高）
└── .codebuddy/skills/        # Agent 运维手册
```

---

## API 速查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/proxy/pool` | 代理池列表与统计，支持 `status` `protocol` `maxLatency` `minScore` `keyword` `limit` |
| GET | `/api/proxy/stats` | 仅统计与任务进度 |
| GET | `/api/proxy/sources` | 源清单 + 各源上次采集结果 |
| GET | `/api/proxy/targets` | 测速回显目标、完整尝试顺序（`attempts`）、本机出口 IP、**直连实测可达的目标（`reachable`）** |
| GET | `/api/proxy/stream` | SSE 实时事件流（进度、日志、逐条测速结果） |
| POST | `/api/proxy/fetch` | 采集，body `{ "sources": ["ip89"] }` |
| POST | `/api/proxy/test` | 测速，body `{ "scope": "unknown", "concurrency": 120 }`（scope 见上文「测速范围的语义」） |
| POST | `/api/proxy/sync` | 采集 + 测速 + 整合导出 |
| POST | `/api/proxy/test-one` | 单条重测，body `{ "id": "http://1.2.3.4:8080" }` |
| POST | `/api/proxy/test-https` | HTTPS 加密流量可达性校验 |
| POST | `/api/proxy/export` | 重新生成 Clash 配置 |
| GET | `/api/proxy/clash.yaml` | 下载完整 Clash 配置 |
| GET | `/api/proxy/clash-provider.yaml` | 仅节点，供 `proxy-providers` 引用 |
| GET | `/api/proxy/clash-snippet` | 可直接粘贴的配置片段 |
| GET / PATCH | `/api/proxy/config` | 读取 / 修改引擎配置 |
| DELETE | `/api/proxy/pool/:id` | 删除单条代理 |
| DELETE | `/api/proxy/pool` | 清空代理池 |

---

## 注意事项

- 免费代理具有天然时效性，**不要期待长期稳定**；建议开启运行时自动更新
- 采集与测速都会发起大量外部连接，请保持合理的并发设置
- 本应用只采集公开的免费代理资源，请勿用于违法用途
- **本应用没有鉴权**：任何能访问到端口的人都能用你的 CodeBuddy API Key，
  对外提供服务前请先按「部署到服务器 → 加上访问保护」加一层认证
- 构建验证：`npm run build`；生产启动验证：`npm start` 后访问 `/api/health`；
  离线逻辑自检：`npm run proxy:selftest`（不联网，覆盖解析器 / 校验 / 评分 / Clash 生成 / 源清单完整性）

### 关于源站可达性

可用源数量**取决于你所在网络**，不是固定值：

- 境外站点（GitHub raw 及其镜像、ProxyScrape、proxy-list.download、openproxy.space、geonode、spys.me 等）
  在部分网络下会直接超时。这类源保留在清单里，网络通畅时才会产出数据；GitHub 类源已配 8 条镜像线路做冗余。
- 国内站普遍上了反爬：快代理用 EdgeOne 机器人防护、开心代理用 JS Cookie 挑战、站大爷返回 405，
  这些都是**服务端主动拦截静态请求**，不是代码问题，已在清单中标注停用。
- 因此若某次采集只有少数几个源成功，属于正常现象。想扩大来源，推荐：
  1. 在「代理源」面板对停用源点「单独采集」，确认是否已恢复；
  2. 按 `server/proxy/sources.ts` 里既有格式追加新源（支持 HTML 表格 / `<br>` 列表 / 纯文本 4 种形态 / JSON）；
  3. 追加后跑一次 `npm run proxy:selftest`，源清单完整性会被自动校验。

### 依赖安装提示

本项目依赖较多，在受限网络下 `npm install` 可能非常慢。**建议一次性装完再开始使用**：
npm 安装过程中会临时移除并重新解压包，此时启动服务会出现 `Cannot find module`，
等安装真正结束即可恢复。若中途被打断，重跑一次 `npm install` 即可修复。
`better-sqlite3` 为可选依赖，装不上会自动降级为 JSON 文件存储，不影响功能。

**如何判断安装是否真的结束**：npm 最后一步才会生成 `node_modules/.bin/` 里的快捷方式与
`node_modules/.package-lock.json`。若 `.bin` 是空的，就说明还没装完 —— 此时
`npm run dev` / `npm run build` 会因为找不到 `tsc`、`vite` 而失败（`npm start` 只依赖 `tsx`，
通常仍能起来，但可能缺别的包）。

安装不完整的两种典型报错（都会被误认成代码问题）：

| 报错 | 真实含义 |
| --- | --- |
| `Cannot find module '@xxx'` | 该包目录被创建了但内容未解压完 |
| `error TS2688: Cannot find type definition file for 'd3-color' / 'qs' / 'geojson' …` | `node_modules/@types/xxx/` 里只剩 `README.md`，缺 `index.d.ts`。因为 tsconfig 未固定 `types`，TypeScript 会自动纳入全部 `@types/*`，任何一个残缺都会让 `tsc -b` 失败 |

想绕开 npm 脚本临时干活时，可直接用本地路径调用：
`node node_modules/typescript/bin/tsc`、`node node_modules/tsx/dist/cli.mjs server/cli.ts stats`。

### npm 源不可达时怎么办（实测记录）

本机默认 registry 指向 `registry.npmmirror.com`，实测**连不上**：TCP 能连（被沙箱出口代理接管），
但 TTFB 一律 10s 超时；`registry.npmjs.org`、`registry.yarnpkg.com` 同样不通。
此时 `npm install` 不会报错，而是**长时间挂起**（表现为建了一堆 `node_modules/.<包名>-<哈希>` 暂存目录
却不再写入任何文件），很容易被误判成「只是慢」。

诊断方法 —— 直接测各镜像的响应时间，别靠猜：

```bash
for u in https://mirrors.cloud.tencent.com/npm/rc https://mirrors.huaweicloud.com/repository/npm/rc \
         https://registry.npmmirror.com/rc https://registry.npmjs.org/rc; do
  printf "%-48s " "$u"
  curl -s -o /dev/null --max-time 10 -w "http=%{http_code} ttfb=%{time_starttransfer}s\n" "$u"
done
```

实测结果（2026-09-16）：腾讯云 ≈0.25s ✅、华为云 ≈0.23s ✅、npmmirror ✗、npmjs ✗。

**一键安装（本机推荐）**——换源 + 关掉安装脚本：

```bash
npm install --no-audit --no-fund --ignore-scripts \
  --registry=https://mirrors.cloud.tencent.com/npm/
```

#### 为什么必须加 `--ignore-scripts`

这是本机安装卡死的**第二个、也更隐蔽的原因**。`better-sqlite3` 虽是可选依赖，但它的
`install` 脚本是 `prebuild-install || node-gyp rebuild --release`：前者要从
**GitHub Releases 下载预编译二进制**，而本机 GitHub 全线不可达；下载失败后又回落到
`node-gyp rebuild`，那需要 MSVC + Python 工具链。

于是 npm 在「所有包都下载解压完、只剩几个安装脚本」的最后阶段**静默挂住** —— 表现是
CPU 不增长、`netstat` 里甚至看不到连接，极易被误判成「npm 自己死锁」。加 `--ignore-scripts`
即可绕过，代价只有一个：`better-sqlite3` 的原生模块不装，存储自动降级为 JSON 文件，
功能不受影响。

**判断是「源不通」还是「卡在安装脚本」**：

| 现象 | 结论 |
| --- | --- |
| 下载阶段就卡住，`node_modules` 文件数几乎不增长 | 源不通，换镜像 |
| 先快速涨到全量体积（数百 MB / 数万文件）、然后停住不动 | 卡在安装脚本（大概率是 `prebuild-install`），加 `--ignore-scripts` |

被中断的安装，重跑 `npm install` **不保证**修好所有残缺的包。它确实会尝试重新解压
（实测会新建一批 `node_modules/.<包名>-<哈希>` 暂存目录），但由于缺 `.package-lock.json` 时
判定依据有限，部分目录可能因为「包目录已存在」被直接跳过 —— 于是重跑一遍仍然报同样的错。
稳妥做法是先清掉暂存目录与已知残缺的包再重装：

```bash
rm -rf node_modules/.*-*        # 清掉 npm 遗留的未完成解压目录（不会碰到 .bin / .cache / .package-lock.json）
npm install --registry=https://mirrors.cloud.tencent.com/npm/ --ignore-scripts
```

> 若要整体删除 `node_modules` 重建，注意本机的批量删除护栏在删除目标超过 50 个时会要求确认
> （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）；被拒绝时 `rm -rf` 会**整条命令都不执行**，
> 看起来却像是删过了。此时不必强删，直接跑增量 `npm install` 也能补齐。
