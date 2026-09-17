import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// 用函数式配置，让开发态端口与后端地址都跟随环境变量。
// 原因：端口与代理目标写死的话，用户按 .env.example 改了 PORT 之后，/api 代理仍指向 3000，
// 表现为「后端起来了但前端所有接口都失败」—— 这类不一致排查起来很费时间。
// loadEnv 的第三个参数传 '' 表示不限定 VITE_ 前缀。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 注意 VITE_PORT 只影响开发态（vite dev server）。生产态由后端单端口提供前端与 API，
  // 两者同源，不再需要这个端口。
  const devPort = Number(env.VITE_PORT || process.env.VITE_PORT || 5173);
  const apiTarget = `http://localhost:${env.PORT || process.env.PORT || 3000}`;

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: devPort,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    css: {
      preprocessorOptions: {
        less: {
          javascriptEnabled: true,
        },
      },
    },
  };
});
