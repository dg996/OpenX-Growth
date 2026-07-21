import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.ts";
import { secureStore } from "../db/schema.ts";
import { aiProviderLabel, appConfig, type AppConfig } from "./config.ts";
import { seal, unseal } from "./sealed.ts";

const SETTINGS_KEY="runtime-settings:v1";
function isPublicProviderHost(hostname:string) {
  const host=hostname.toLowerCase().replace(/^\[|\]$/g,"");
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host.endsWith(".home.arpa"))return false;
  const ipv4=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if(ipv4&&ipv4.every((part)=>part>=0&&part<=255))return !(ipv4[0]===10||ipv4[0]===127||ipv4[0]===0||(ipv4[0]===169&&ipv4[1]===254)||(ipv4[0]===172&&ipv4[1]>=16&&ipv4[1]<=31)||(ipv4[0]===192&&ipv4[1]===168)||(ipv4[0]===100&&ipv4[1]>=64&&ipv4[1]<=127)||ipv4[0]>=224);
  if(host.includes(":"))return !(host==="::"||host==="::1"||host.startsWith("::ffff:")||host.startsWith("fc")||host.startsWith("fd")||host.startsWith("fe8")||host.startsWith("fe9")||host.startsWith("fea")||host.startsWith("feb")||host.startsWith("ff"));
  return true;
}
const httpsUrl=z.string().trim().min(1).max(2_048).url().refine((value)=>{
  const url=new URL(value);
  return url.protocol==="https:"&&!url.username&&!url.password&&!url.search&&!url.hash&&isPublicProviderHost(url.hostname);
},{message:"Use a public HTTPS provider URL without credentials, query parameters, or fragments."});
const optionalSecret=z.string().min(8).max(4_096).optional();

export const runtimeSettingsInputSchema=z.discriminatedUnion("section",[
  z.object({section:z.literal("x"),clientId:z.string().trim().min(3).max(512),clientSecret:optionalSecret,clearClientSecret:z.boolean().optional().default(false)}).strict(),
  z.object({section:z.literal("ai"),baseUrl:httpsUrl,model:z.string().trim().min(1).max(200),apiKey:optionalSecret,clearApiKey:z.boolean().optional().default(false),contentApproved:z.boolean(),repliesApproved:z.boolean()}).strict(),
  z.object({section:z.literal("publishing"),evergreenEnabled:z.boolean(),syncTtlSeconds:z.number().int().min(60).max(86_400),cronSecret:optionalSecret,clearCronSecret:z.boolean().optional().default(false),apiToken:optionalSecret,clearApiToken:z.boolean().optional().default(false)}).strict(),
  z.object({section:z.literal("access"),appAccessToken:z.string().min(16).max(4_096)}).strict(),
]);

const managedSettingsSchema=z.object({
  xClientId:z.string().max(512).optional(),
  xClientSecret:z.string().max(4_096).optional(),
  appAccessToken:z.string().max(4_096).optional(),
  cronSecret:z.string().max(4_096).optional(),
  apiToken:z.string().max(4_096).optional(),
  aiBaseUrl:httpsUrl.optional(),
  aiApiKey:z.string().max(4_096).optional(),
  aiModel:z.string().max(200).optional(),
  xAiContentApproved:z.boolean().optional(),
  xAiRepliesApproved:z.boolean().optional(),
  evergreenEnabled:z.boolean().optional(),
  syncTtlSeconds:z.number().int().min(60).max(86_400).optional(),
}).strict();

export type ManagedSettings=z.infer<typeof managedSettingsSchema>;
export type RuntimeSettingsInput=z.infer<typeof runtimeSettingsInputSchema>;

export async function loadManagedSettings():Promise<ManagedSettings> {
  try{
    const row=await getDb().select().from(secureStore).where(eq(secureStore.key,SETTINGS_KEY)).get();
    const value=await unseal<unknown>(row?.sealedValue);
    const parsed=managedSettingsSchema.safeParse(value);
    return parsed.success?parsed.data:{};
  }catch{return {};}
}

export async function getEffectiveConfig():Promise<AppConfig> {
  const base=appConfig(),managed=await loadManagedSettings();
  return {...base,...managed,sessionSecret:base.sessionSecret};
}

async function storeManagedSettings(value:ManagedSettings) {
  const parsed=managedSettingsSchema.parse(value),updatedAt=Date.now(),sealedValue=await seal(parsed);
  await getDb().insert(secureStore).values({key:SETTINGS_KEY,sealedValue,updatedAt}).onConflictDoUpdate({target:secureStore.key,set:{sealedValue,updatedAt}});
  return updatedAt;
}

export async function updateManagedSettings(input:RuntimeSettingsInput) {
  const current=await loadManagedSettings();
  let next:ManagedSettings={...current};
  if(input.section==="x")next={...next,xClientId:input.clientId,...(input.clientSecret!==undefined?{xClientSecret:input.clientSecret}:{}),...(input.clearClientSecret?{xClientSecret:""}:{})};
  if(input.section==="ai")next={...next,aiBaseUrl:input.baseUrl,aiModel:input.model,xAiContentApproved:input.contentApproved,xAiRepliesApproved:input.repliesApproved,...(input.apiKey!==undefined?{aiApiKey:input.apiKey}:{}),...(input.clearApiKey?{aiApiKey:""}:{})};
  if(input.section==="publishing")next={...next,evergreenEnabled:input.evergreenEnabled,syncTtlSeconds:input.syncTtlSeconds,...(input.cronSecret!==undefined?{cronSecret:input.cronSecret}:{}),...(input.clearCronSecret?{cronSecret:""}:{}),...(input.apiToken!==undefined?{apiToken:input.apiToken}:{}),...(input.clearApiToken?{apiToken:""}:{})};
  if(input.section==="access")next={...next,appAccessToken:input.appAccessToken};
  return storeManagedSettings(next);
}

export async function runtimeSettingsView() {
  const config=await getEffectiveConfig();
  return {
    x:{clientId:config.xClientId,clientSecretConfigured:Boolean(config.xClientSecret)},
    ai:{provider:aiProviderLabel(config.aiBaseUrl),baseUrl:config.aiBaseUrl,model:config.aiModel,apiKeyConfigured:Boolean(config.aiApiKey),contentApproved:config.xAiContentApproved,repliesApproved:config.xAiRepliesApproved},
    publishing:{evergreenEnabled:config.evergreenEnabled,syncTtlSeconds:config.syncTtlSeconds,cronSecretConfigured:Boolean(config.cronSecret),apiTokenConfigured:Boolean(config.apiToken)},
    access:{appAccessTokenConfigured:Boolean(config.appAccessToken),sessionSecretConfigured:Boolean(config.sessionSecret)},
  };
}
