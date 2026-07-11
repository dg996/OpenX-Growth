type RuntimeEnv = Record<string,string | undefined>;

export function env(name:string, fallback?:string):string {
  const runtime = (globalThis.__OPENX_ENV__ ?? {}) as RuntimeEnv;
  return process.env[name] ?? runtime[name] ?? fallback ?? "";
}

export function requiredEnv(name:string):string {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const appConfig = () => ({
  appUrl: env("APP_URL"),
  xClientId: env("X_CLIENT_ID"),
  xClientSecret: env("X_CLIENT_SECRET"),
  sessionSecret: env("SESSION_SECRET"),
  cronSecret: env("CRON_SECRET"),
  apiToken: env("OPENX_API_TOKEN"),
  appAccessToken: env("APP_ACCESS_TOKEN"),
  aiProvider: env("AI_PROVIDER","openai-compatible"),
  aiBaseUrl: env("AI_BASE_URL","https://api.openai.com/v1"),
  aiApiKey: env("AI_API_KEY"),
  aiModel: env("AI_MODEL","gpt-5-mini"),
  xAiContentApproved: env("X_AI_CONTENT_APPROVED","false") === "true",
  xAiRepliesApproved: env("X_AI_REPLIES_APPROVED","false") === "true",
  evergreenEnabled: env("ENABLE_EVERGREEN","false") === "true",
  maxDailyReads: Number(env("MAX_DAILY_X_READS","500")),
  maxDailyWrites: Number(env("MAX_DAILY_X_WRITES","50")),
  syncTtlSeconds: Number(env("SYNC_TTL_SECONDS","900")),
});

export function publicConfig() {
  const config = appConfig();
  return {
    configured:Boolean(config.xClientId && config.sessionSecret),
    accessProtected:Boolean(config.appAccessToken),
    aiConfigured:Boolean(config.aiApiKey),
    aiContentApproved:config.xAiContentApproved,
    aiRepliesApproved:config.xAiRepliesApproved,
    evergreenEnabled:config.evergreenEnabled,
    syncTtlSeconds:config.syncTtlSeconds,
  };
}
