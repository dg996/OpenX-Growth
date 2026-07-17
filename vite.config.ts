import vinext from "vinext";
import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { sites } from "./build/sites-vite-plugin";

const hostingPath = new URL("./.openai/hosting.json",import.meta.url);
const hostingConfig = existsSync(hostingPath) ? JSON.parse(readFileSync(hostingPath,"utf8")) as {d1?:string|null;r2?:string|null} : {d1:"DB",r2:null};

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const disableEnvFiles=process.env.OPENX_E2E==="1"||process.env.OPENX_DISABLE_ENV_FILES==="1";
const e2eBindingNames=[
  "APP_URL","X_CLIENT_ID","SESSION_SECRET","APP_ACCESS_TOKEN","OPENX_API_TOKEN","CRON_SECRET",
  "AI_API_KEY","AI_BASE_URL","AI_MODEL","X_AI_CONTENT_APPROVED","X_AI_REPLIES_APPROVED",
  "MAX_DAILY_X_RESOURCES","MAX_DAILY_X_WRITES","OPENX_E2E","OPENX_E2E_X_FIXTURE",
  "OPENX_E2E_SYNC_DELAY_MS","OPENX_E2E_SYNC_STATUS","OPENX_E2E_SYNC_SPARSE",
] as const;
const e2eVars=process.env.OPENX_E2E==="1"
  ? Object.fromEntries(e2eBindingNames.map((name)=>[name,process.env[name]??""]))
  : undefined;

const localBindingConfig = {
  main: process.env.OPENX_E2E==="1" ? "./tests/fixtures/worker.e2e.ts" : "./worker/index.ts",
  ...(e2eVars?{vars:e2eVars}:{}),
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

const localWorkerConfig = existsSync(new URL("./wrangler.jsonc", import.meta.url))
  ? localBindingConfig
  : {
      ...localBindingConfig,
      // Vinext's SSR runtime imports Node APIs. A checked-out project has no
      // instance config yet, so it needs the same compatibility mode as deploy.
      compatibility_date: "2026-05-22",
      compatibility_flags: ["nodejs_compat"],
    };

export default defineConfig(async () => {
  const e2eStateDir=process.env.OPENX_E2E_STATE_DIR;
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    ...(disableEnvFiles?{envFile:false}:{}),
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        ...(e2eStateDir?{persistState:{path:e2eStateDir}}:{}),
        config: localWorkerConfig,
      }),
    ],
  };
});
