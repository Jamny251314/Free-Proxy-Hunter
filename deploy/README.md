# deploy/ · 部署模板索引

这些文件都是**模板**，按需复制到目标位置，不是自动生效的。

| 文件 | 用在哪 | 目标位置 |
| --- | --- | --- |
| `proxy-hunter.service` | systemd 托管的裸机/虚机部署 | `/etc/systemd/system/proxy-hunter.service` |
| `nginx.conf` | Nginx 反代 + Basic Auth | `/etc/nginx/conf.d/proxy-hunter.conf` |
| `cloudflared.yml` | Cloudflare Tunnel（命名隧道） | `/etc/cloudflared/config.yml` |
| `pages/_redirects` | Cloudflare Pages 让 `/api` 同源 | 前端 `public/_redirects` |

选型建议（从省事到灵活）：

1. **只给自己用** → Docker Compose 或 systemd + `127.0.0.1` 绑定，再配 Cloudflare Tunnel + Access。
   不用公网 IP、不用开防火墙、鉴权交给 Cloudflare。
2. **有公网 IP 和域名** → Nginx 反代 + Basic Auth（或 certbot 上 HTTPS）。
3. **前端想放 CDN** → Cloudflare Pages 托管 `dist/`，用 `pages/_redirects` 把 `/api` 代理回后端。

容器化的部分见仓库根的 `Dockerfile`、`.dockerignore`、`docker-compose.yml`。

---

## 平台要求

### Node.js 版本

**必须 20.12+（推荐 22）**。后端用 Node 内置的 `process.loadEnvFile()` 读 `.env`，
低于 20.12 该 API 不存在，会退化成「只认真实环境变量」并打印一条告警。

### Linux 发行版与 glibc

Node.js 18 及以上的官方 Linux 二进制要求 **glibc ≥ 2.28**，这条线决定了发行版能不能直接用：

| 发行版 | glibc | 能否直接跑 |
| --- | --- | --- |
| CentOS 7 | 2.17 | ❌ **不行**。且已于 2024-06 EOL，NodeSource 也停止支持 |
| CentOS 8 / Stream 8 | 2.28 | ⚠️ 可以，但 CentOS 8 已于 2021-12 EOL |
| CentOS Stream 9 | 2.34 | ✅ 推荐 |
| Rocky Linux 8 / 9、AlmaLinux 8 / 9 | 2.28 / 2.34 | ✅ 推荐（CentOS 的实际继任者） |
| Ubuntu 20.04 / 22.04 / 24.04 | 2.31 / 2.35 / 2.39 | ✅ |
| Debian 11 / 12 | 2.31 / 2.36 | ✅ |

**CentOS 7 怎么办**：不要试图在它上面装 Node 22（会报
`GLIBC_2.28 not found`）。两条可行路径：

- 换 Rockyy/Alma 9，或 CentOS Stream 9；
- 或者把应用放进容器，在 CentOS 7 上只跑 Docker —— 容器里是 Debian 的 glibc，
  与宿主的 2.17 无关。

### RHEL 系（CentOS / Rocky / Alma）两个经典坑

1. **SELinux 拦住 Nginx 反代**
   症状：Nginx 报 `502`，`/var/log/nginx/error.log` 里是
   `Permission denied while connecting to upstream`。
   SELinux 默认不允许 httpd 主动外连，与防火墙无关。

   ```bash
   sudo setsebool -P httpd_can_network_connect 1
   # 确认状态
   getsebool httpd_can_network_connect     # 应为 on
   ```

2. **firewalld 只放 Nginx 的端口，不要放 3000**
   应用已用 `HOST=127.0.0.1` 绑定回环，外部本来就访问不到，这是有意的：

   ```bash
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --permanent --add-service=https
   sudo firewall-cmd --reload
   ```

   只有确实要让 3000 直接对外（且已自行加了访问控制）时才放开它。

---

## 关于 Agent 的目录权限（别急着用只读加固）

这个项目的 Agent **按设计会读写项目文件** —— 「帮我加一个代理源」这类请求会真的去改
`server/proxy/sources.ts`。同时 Agent SDK 会拉起 CodeBuddy CLI，它需要一个可写的 `HOME`
（缓存与配置）。

所以不要给 systemd 单元加 `ProtectSystem=strict` / `ProtectHome=true`，
也不要给容器挂只读的 `/app`。`deploy/proxy-hunter.service` 里已经注明了原因，
只保留了不会破坏功能的加固项。

`data/` 目录是另一回事：它只需要运行用户可写，容器部署挂卷时务必确认属主对得上，
否则首次启动会直接 `EACCES`。

---

## 部署后自检

```bash
curl -s  http://127.0.0.1:3000/api/health                          # {"status":"ok",...}
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/      # 200
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/nope   # 404（不是 HTML）
```

启动横幅会打印**实际生效的**端口、前端托管状态、数据库驱动、代理池规模和数据目录路径 ——
「数据怎么没了」这类问题，先对着 `数据目录` 那一行和挂载点比一比。
