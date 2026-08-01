import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";
import hostingConfig from "./.openai/hosting.json";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const { d1 } = hostingConfig;

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    server: isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
          triggers: { crons: ["* * * * *"] },
          d1_databases: d1 ? [{ binding: d1, database_name: "zapiski-assistant", database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID }] : [],
        },
      }),
    ],
  };
});
