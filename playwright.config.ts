import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 5 * 60 * 1000, // 5 min per test (AI extraction can be slow)
  expect: { timeout: 30_000 },
  fullyParallel: false, // sequential — tests share a logged-in user account
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    headless: false, // visível para depuração
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Não inicia o servidor — o dev server deve estar rodando em localhost:3000
  webServer: undefined,
});
