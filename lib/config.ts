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
  maxDailyResources: Number(env("MAX_DAILY_X_RESOURCES",env("MAX_DAILY_X_READS","500"))),
  maxDailyReads: Number(env("MAX_DAILY_X_RESOURCES",env("MAX_DAILY_X_READS","500"))),
  maxDailyWrites: Number(env("MAX_DAILY_X_WRITES","50")),
  syncTtlSeconds: Number(env("SYNC_TTL_SECONDS","900")),
});

export function instanceConfigured() {
  const config = appConfig();
  return Boolean(config.xClientId && config.sessionSecret);
}

export type DeploymentPosture="demo"|"misconfigured"|"protected";

export type XConfigurationSummary={
  xClientIdConfigured:boolean;
  xClientSecretConfigured:boolean;
  sessionSecretConfigured:boolean;
  appUrlConfigured:boolean;
  appAccessTokenConfigured:boolean;
  cronSecretConfigured:boolean;
  apiTokenConfigured:boolean;
};

export type AiConfigurationSummary={
  provider:"OpenRouter"|"OpenAI"|"Custom OpenAI-compatible";
  model:string;
  apiKeyConfigured:boolean;
  contentApproved:boolean;
  repliesApproved:boolean;
  state:"disabled"|"configured_not_approved"|"ready";
};

export function deploymentPosture():DeploymentPosture {
  const config=appConfig();
  if(config.appAccessToken)return "protected";
  return instanceConfigured()?"misconfigured":"demo";
}

export function aiProviderLabel(baseUrl:string):AiConfigurationSummary["provider"] {
  try {
    const hostname=new URL(baseUrl).hostname.toLowerCase();
    if(hostname==="openrouter.ai"||hostname.endsWith(".openrouter.ai"))return "OpenRouter";
    if(hostname==="openai.com"||hostname.endsWith(".openai.com"))return "OpenAI";
  } catch {}
  return "Custom OpenAI-compatible";
}

export function protectedConfigSummary():{xConfiguration?:XConfigurationSummary;aiConfiguration?:AiConfigurationSummary} {
  if(deploymentPosture()!=="protected")return {};
  const config=appConfig();
  return {
    xConfiguration:{
      xClientIdConfigured:Boolean(config.xClientId),
      xClientSecretConfigured:Boolean(config.xClientSecret),
      sessionSecretConfigured:Boolean(config.sessionSecret),
      appUrlConfigured:Boolean(config.appUrl),
      appAccessTokenConfigured:Boolean(config.appAccessToken),
      cronSecretConfigured:Boolean(config.cronSecret),
      apiTokenConfigured:Boolean(config.apiToken),
    },
    aiConfiguration:{
      provider:aiProviderLabel(config.aiBaseUrl),
      model:config.aiModel,
      apiKeyConfigured:Boolean(config.aiApiKey),
      contentApproved:config.xAiContentApproved,
      repliesApproved:config.xAiRepliesApproved,
      state:!config.aiApiKey?"disabled":config.xAiContentApproved?"ready":"configured_not_approved",
    },
  };
}

export function publicConfig() {
  const config = appConfig();
  const posture=deploymentPosture();
  return {
    configured:instanceConfigured(),
    demoMode:posture==="demo",
    accessProtected:posture==="protected",
    configurationError:posture==="misconfigured"?"APP_ACCESS_TOKEN_REQUIRED":null,
    aiConfigured:Boolean(config.aiApiKey),
    aiContentApproved:config.xAiContentApproved,
    aiRepliesApproved:config.xAiRepliesApproved,
    evergreenEnabled:config.evergreenEnabled,
    syncTtlSeconds:config.syncTtlSeconds,
  };
}
