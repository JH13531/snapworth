import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 可用 PW_CHROMIUM 环境变量指定本机 Chromium 路径；缺省用 Playwright 自带浏览器
    launchOptions: process.env.PW_CHROMIUM
      ? { executablePath: process.env.PW_CHROMIUM }
      : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
