import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

/**
 * 开发模式下移除 index.html 中的 CSP meta 标签——Vite 的 React Refresh
 * 需要注入内联脚本，严格 CSP 会阻止 dev 模式运行。生产构建不受影响。
 */
function stripCspInDev(): Plugin {
  let isDev = false
  return {
    name: 'snapworth:strip-csp-dev',
    enforce: 'pre',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      if (!isDev) return html
      return html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
        .replace(/<!--[\s\S]*?Content Security Policy[\s\S]*?-->\s*/g, '')
    },
  }
}

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
  },
  plugins: [
    stripCspInDev(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Snapworth 资产复盘',
        short_name: '资产复盘',
        description: '每月 3 分钟，看清个人资产全貌',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        // 相对路径：子路径部署（如 GitHub Pages /snapworth/）时也能正确指向应用入口
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // 图标为满幅蓝底 + 居中钱包，关键内容在中心 80% 安全区内，可直接复用为 maskable
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // devOptions 启用时 vite-plugin-pwa 会把 dev-dist/ 作为额外 globDirectory
        // 传给 workbox；目录在 prod build 时为空，触发 "glob patterns doesn't match
        // any files" 警告。用 globIgnores 把它从 precache 候选里排除掉。
        globIgnores: ['**/dev-dist/**'],
      },
      // 默认只在生产构建注入 manifest 与 SW，dev 模式下 PWA 不可安装（无安装图标）。
      // 开启后 dev 也能测试「安装为应用」与离线能力。
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    })
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
          crypto: ['hash-wasm'],
          vendor: ['react', 'react-dom', 'react-router-dom', 'zustand', 'dexie', 'decimal.js', 'date-fns'],
        },
      },
    },
  },
})
