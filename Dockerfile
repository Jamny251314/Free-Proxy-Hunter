# syntax=docker/dockerfile:1
#
# 免费代理猎手 · 容器镜像
# ---------------------------------------------------------------
# 设计取舍（都不是随手选的，改动前请先读）：
#
# 1. 基础镜像用 bookworm-slim（Debian + glibc），**不要**换成 alpine。
#    Agent SDK 内置的 CodeBuddy CLI（node_modules/@tencent-ai/agent-sdk/cli/bin）
#    与 better-sqlite3 都依赖 glibc 的原生/预编译产物，alpine 的 musl 跑不起来。
#
# 2. 不装 curl：健康检查用 Node 自带的 fetch，少一层依赖与一个 CVE 面。
#
# 3. 启动命令直接用 node + tsx，**不用 npm start**。
#    npm 会多一层进程，SIGTERM 不一定能透传到真正干活的进程 ——
#    那样 index.ts 里的优雅退出（把代理池落盘）就白写了，
#    docker stop 时「刚测完一轮」的数据会安静地丢掉。
#
# 4. 默认跳过 npm 安装脚本（--ignore-scripts）。原因是 better-sqlite3 的
#    install 脚本为 `prebuild-install || node-gyp rebuild`，前者要从 GitHub
#    Releases 拉预编译二进制 —— 在没有 GitHub 出口的网络里 npm 会**静默挂住**
#    （不是报错，是挂住）。代价仅是原生模块不装，应用自动降级为 JSON 存储，
#    功能不受影响。需要 SQLite 时见下方 INSTALL_NATIVE_SQLITE 构建参数。
#
# 5. 数据目录固定为 /app/data 并声明为 VOLUME：代理池、引擎配置、Clash 产物、
#    会话记录都在里面。不挂卷的话，容器一重建这些全没了 ——
#    而且表现是「网站还能打开，但代理池空了」，很容易误判成程序坏了。
#
# 本机（Windows、无 Docker）无法实际验证构建，改动后请在目标机器上跑：
#   docker build -t proxy-hunter-agent .
#   docker run --rm -p 3000:3000 -v "$PWD/data:/app/data" proxy-hunter-agent

# ---------------------------------------------------------------------------
# 阶段 1：构建前端 + 裁剪依赖
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# 只先拷依赖清单：只要这两个文件没变，npm ci 这一层就能命中缓存，
# 改业务代码不会触发重新安装依赖。
COPY package.json package-lock.json ./

ARG INSTALL_NATIVE_SQLITE=false
RUN if [ "$INSTALL_NATIVE_SQLITE" = "true" ]; then \
      echo "[build] 安装原生 better-sqlite3（需要能访问 GitHub Releases 或有 C++ 工具链）" && \
      npm ci --no-audit --no-fund; \
    else \
      echo "[build] 跳过安装脚本，better-sqlite3 不安装，运行时降级为 JSON 存储" && \
      npm ci --no-audit --no-fund --ignore-scripts; \
    fi

# 源码在依赖之后拷入：让上面那层缓存真正生效
COPY . .

# tsc -b && vite build → dist/
RUN npm run build

# 只留运行时依赖（express / tsx / @tencent-ai/agent-sdk 等）。
# tsx 已在 dependencies 里，所以裁掉 dev 依赖后依然能启动。
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# 阶段 2：运行时
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

WORKDIR /app

# 用官方镜像自带的 node 用户（uid 1000），不额外新建：
# 非 root 运行是容器里的基本要求，也让挂载卷的属主更好对齐。
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
COPY --from=builder --chown=node:node /app/server       ./server
COPY --from=builder --chown=node:node /app/package.json ./package.json

# 预建数据目录并交给 node 用户。
# 少了这一步，首次以非 root 挂载空卷时会直接 EACCES 起不来，
# 报错信息还很难指向「挂载点属主不对」这个真实原因。
RUN mkdir -p /app/data && chown -R node:node /app/data

VOLUME ["/app/data"]

USER node

EXPOSE 3000

# 健康检查：用 /api/health，它只读内存、不触碰网络探测，开销可忽略
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
