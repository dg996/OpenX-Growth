"use client";

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleGauge,
  CreditCard,
  Clock3,
  Code2,
  FileText,
  Flame,
  Github,
  Home,
  Lightbulb,
  Link2,
  MessageCircle,
  Moon,
  MoreHorizontal,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { buildChartCoordinates } from "../lib/chart";
import { buildGrowthPlan, buildGrowthPlanDraftSeed } from "../lib/growth-plan";
import { aiErrorGuidance, decideOnboarding, growthPlanEmptyGuidance, hasAiRewriteSource, hasLivePlanningData, isAiContentReady, isWorkspaceBlocking, ONBOARDING_STORAGE_KEY, resolveWorkspaceState, sanitizeSyncError, syncErrorGuidance, type WorkspaceState } from "../lib/ui-state";
import type { IdeaSignal, ReplyOpportunity } from "../lib/x-growth";

type View = "Overview" | "Discover" | "Content" | "Schedule" | "Analytics" | "Settings";
type SettingsSection = "x" | "ai" | "publishing" | "limits" | "security" | "data";
type PostStatus = "Draft" | "Scheduled" | "Publishing" | "Published" | "Failed" | "Needs review";

type ContentItem = {
  id: number | string;
  text: string;
  status: PostStatus;
  date: string;
  rate?: string;
  impressions?: string;
  evergreen?: boolean;
  lastError?: string;
};

type SavePostInput = {text:string;thread:string[];scheduledAt?:number;evergreen:boolean;evergreenIntervalDays?:number;generated:boolean;topic?:string;hook?:string};
type XConfigurationSummary={xClientIdConfigured:boolean;xClientSecretConfigured:boolean;sessionSecretConfigured:boolean;appUrlConfigured:boolean;appAccessTokenConfigured:boolean;cronSecretConfigured:boolean;apiTokenConfigured:boolean};
type AiConfigurationSummary={provider:"OpenRouter"|"OpenAI"|"Custom OpenAI-compatible";model:string;apiKeyConfigured:boolean;contentApproved:boolean;repliesApproved:boolean;state?:"disabled"|"configured_not_approved"|"ready"};
type AuthorizationState="disconnected"|"connected"|"authorization_check_required"|"reconnect_required"|"oauth_in_progress"|"oauth_failed";
type RuntimeSync={state:"never"|"ready"|"in_progress"|"succeeded"|"failed"|"budget_exhausted";lastAttemptAt?:number;lastSuccessfulAt?:number;lastErrorCode?:string|null;freshness:"unavailable"|"live"|"cached_fresh"|"cached_stale";cacheAvailable:boolean;activeMaxReadResources?:number;activeMaxRequests?:3|4;next:{enabled:boolean;blockedReason:string|null;maxReadResources:number;maxRequests:3|4;writes:0}};
type RuntimeUsage={usedResources:number;inUseResources:number;availableResources:number;maxResources:number;maxSyncResources:number;usedWrites:number;availableWrites:number;maxWrites:number;deploymentMaxResources:number;deploymentMaxWrites:number;userConfigured:boolean;resetsAt:string};
type RuntimeReadiness={overall:"unavailable"|"insufficient"|"partial"|"sufficient";contentRecommendation:string;replyRanking:string;analytics:string;followerHistory:string};
type AppRuntimeConfig={configured:boolean;demoMode:boolean;accessProtected:boolean;aiConfigured:boolean;aiContentApproved:boolean;aiRepliesApproved:boolean;evergreenEnabled:boolean;syncTtlSeconds:number;usageControlsEnabled?:boolean;xConfiguration?:XConfigurationSummary;aiConfiguration?:AiConfigurationSummary;connected?:boolean;origin?:{configured:boolean;currentMatchesCanonical:boolean};authorization?:{state:AuthorizationState;lastVerifiedAt?:number};sync?:RuntimeSync;usage?:RuntimeUsage;readiness?:RuntimeReadiness};
type RuntimeStatus=AppRuntimeConfig&{connected:boolean};
type ProvenanceSource="demo"|"live"|"derived"|"estimate";
type Provenance={source:ProvenanceSource;recordedAt:number};
type Metric<T>={value:T;provenance:Provenance};
type AnalyticsBreakdown={label:string;posts:number;impressions:number;engagements:number;medianEngagementRate:Metric<number>;provenance:Provenance};
type AnalyticsData={
  dataStatus:"available"|"insufficient_data";
  range:{key:string;startAt:number;endAt:number};
  derived:{
    totals:{impressions:Metric<number>;likes:Metric<number>;replies:Metric<number>;reposts:Metric<number>;engagements:Metric<number>;engagementRate:Metric<number>};
    series:Array<{recordedAt:number;impressions:Metric<number>;engagements:Metric<number>;engagementRate:Metric<number>}>;
    byTopic:AnalyticsBreakdown[];byFormat:AnalyticsBreakdown[];byHook:AnalyticsBreakdown[];byHour:AnalyticsBreakdown[];
  };
  followers:{status:"ready"|"insufficient_data";minimumSamples:number;series:Array<{recordedAt:number;followers:Metric<number>}>};
  postingTimes:{status:"ready"|"insufficient_data";minimumSamples:number;sampleSize:number;method:string;suggestions:Array<{hour:number;label:string;sampleSize:number;medianEngagementRate:number;provenance:Provenance}>};
  usage:{requests:number;resources:number;reservedResources:number;writes:number;maxResources:number;maxSyncResources:number;maxWrites:number;deploymentMaxResources:number;deploymentMaxWrites:number;userConfigured:boolean;remainingResources:number;remainingWrites:number;warning:boolean;reads:number;maxReads:number;provenance:Provenance};
};
type AccountProfile={id:string;name:string;username:string;profileImageUrl?:string;followersCount?:number};
type StoredPost={id:string;text:string;status:string;scheduledAt?:number;publishedAt?:number;evergreen?:boolean;lastError?:string};
type PostsPayload={posts:StoredPost[]};
type SyncPayload={account:AccountProfile;opportunities:ReplyOpportunity[];ideas:IdeaSignal[];syncedAt:string;error?:string;replayed?:boolean};
type SyncCachePayload={available:boolean;data?:SyncPayload;cache?:{syncedAt:string;freshness:"cached_fresh"|"cached_stale"}};
type AiPayload={content?:string|string[];rationale?:string;generated?:boolean;error?:string};
type AiRequest={kind:"idea"|"post"|"thread"|"reply"|"rewrite";prompt:string;context?:string};
type ComposerSeed={parts:string[];topic?:string;generated:boolean};
type AiRewriteAction="Stronger hook"|"Shorten"|"Match my voice";
type RuntimeSettingsData={
  x:{clientId:string;clientSecretConfigured:boolean};
  ai:{provider:"OpenRouter"|"OpenAI"|"Custom OpenAI-compatible";baseUrl:string;model:string;apiKeyConfigured:boolean;contentApproved:boolean;repliesApproved:boolean};
  publishing:{evergreenEnabled:boolean;syncTtlSeconds:number;cronSecretConfigured:boolean;apiTokenConfigured:boolean};
  access:{appAccessTokenConfigured:boolean;sessionSecretConfigured:boolean};
};

const postStatusLabel=(status:string):PostStatus=>status==="needs_review"?"Needs review":`${status.charAt(0).toUpperCase()}${status.slice(1)}` as PostStatus;
const localResetLabel=(value?:string)=>{
  const reset=value?new Date(value):null;
  return reset&&Number.isFinite(reset.getTime())
    ? reset.toLocaleString([], {weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZoneName:"short"})
    : "00:00 UTC";
};

async function fetchAnalyticsData(range="28D"):Promise<AnalyticsData | undefined>{const response=await fetch(`/api/analytics?range=${encodeURIComponent(range)}`);return response.ok?await response.json() as AnalyticsData:undefined}

async function fetchXCache():Promise<SyncCachePayload>{
  const response=await fetch("/api/x/sync");
  const payload=await response.json() as SyncCachePayload&{error?:string};
  if(!response.ok)throw new Error(sanitizeSyncError(payload.error));
  return payload;
}

async function postXSync(csrf:string,idempotencyKey:string):Promise<SyncPayload>{
  const response=await fetch("/api/x/sync",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf,"Idempotency-Key":idempotencyKey},body:"{}"});
  const payload=await response.json() as SyncPayload;
  if(!response.ok)throw new Error(sanitizeSyncError(payload.error));
  return payload;
}

async function requestAiGeneration(csrf:string,input:AiRequest,signal?:AbortSignal):Promise<AiPayload&{content:string|string[]}> {
  const response=await fetch("/api/ai/generate",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(input),signal});
  let payload:AiPayload;
  try{payload=await response.json() as AiPayload}catch{throw new Error("AI_INVALID_RESPONSE")}
  const validContent=typeof payload.content==="string"||(Array.isArray(payload.content)&&payload.content.every((part)=>typeof part==="string"));
  if(!response.ok||!validContent)throw new Error(payload.error??"AI_INVALID_RESPONSE");
  return payload as AiPayload&{content:string|string[]};
}

const navItems = [
  { label: "Overview" as View, icon: Home },
  { label: "Discover" as View, icon: Flame },
  { label: "Content" as View, icon: FileText },
  { label: "Schedule" as View, icon: CalendarDays },
  { label: "Analytics" as View, icon: BarChart3 },
];

const signals: IdeaSignal[] = [
  { topic: "Open source AI", change: "Demo topic · connect X for live data", score: 92, bars: [4, 7, 9, 12, 14, 13, 10, 8, 9, 11, 14, 16, 18], hook:"Most people misunderstand open source AI. Here is what they miss:", rationale:"Demo idea",pillar:"Industry insight",scoreProvenance:{source:"demo",recordedAt:0} },
  { topic: "Build in public", change: "Demo topic · connect X for live data", score: 78, bars: [3, 5, 8, 9, 8, 7, 6, 5, 7, 8, 10, 12, 15], hook:"Building in public is not a content strategy. It is a feedback loop.", rationale:"Demo idea",pillar:"Build in public",scoreProvenance:{source:"demo",recordedAt:0} },
  { topic: "AI agents", change: "Demo topic · connect X for live data", score: 65, bars: [4, 8, 6, 10, 7, 9, 8, 6, 9, 12, 10, 11, 15], hook:"AI agents are about to change the size of the average startup team.", rationale:"Demo idea",pillar:"Product thesis",scoreProvenance:{source:"demo",recordedAt:0} },
  { topic: "European tech", change: "Demo topic · connect X for live data", score: 54, bars: [3, 4, 5, 7, 6, 8, 7, 9, 8, 10, 11, 12, 13], hook:"Europe does not have a talent problem. It has a distribution problem.", rationale:"Demo idea",pillar:"Industry insight",scoreProvenance:{source:"demo",recordedAt:0} },
  { topic: "Founder-led growth", change: "Demo topic · connect X for live data", score: 41, bars: [2, 4, 5, 4, 7, 6, 9, 8, 7, 9, 10, 11, 12], hook:"Founder-led growth works because customers want proximity to conviction.", rationale:"Demo idea",pillar:"Founder lesson",scoreProvenance:{source:"demo",recordedAt:0} },
];

const opportunities: ReplyOpportunity[] = [
  { id:"demo-1", initials:"SB",name:"Sample Builder",handle:"@samplebuilder",post:"What is one underrated habit that changed how you build products?",reach:"48K",relevance:92,url:"https://x.com",suggestedReply:"",reason:"Demo opportunity · connect X for live ranking",reachProvenance:{source:"demo",recordedAt:0},relevanceProvenance:{source:"demo",recordedAt:0} },
  { id:"demo-2", initials:"OF",name:"Open Founder",handle:"@openfounder",post:"Open source is becoming a distribution advantage, not only a licensing choice.",reach:"32K",relevance:88,url:"https://x.com",suggestedReply:"",reason:"Demo opportunity · connect X for live ranking",reachProvenance:{source:"demo",recordedAt:0},relevanceProvenance:{source:"demo",recordedAt:0} },
  { id:"demo-3", initials:"IP",name:"Indie Product",handle:"@indieproduct",post:"Building in public works best when the feedback changes the product.",reach:"24K",relevance:85,url:"https://x.com",suggestedReply:"",reason:"Demo opportunity · connect X for live ranking",reachProvenance:{source:"demo",recordedAt:0},relevanceProvenance:{source:"demo",recordedAt:0} },
  { id:"demo-4", initials:"SG",name:"SaaS Growth",handle:"@saasgrowth",post:"Founders: what is your most reliable growth loop right now?",reach:"19K",relevance:82,url:"https://x.com",suggestedReply:"",reason:"Demo opportunity · connect X for live ranking",reachProvenance:{source:"demo",recordedAt:0},relevanceProvenance:{source:"demo",recordedAt:0} },
];

const initialContent: ContentItem[] = [
  { id: 1, text: "The 3 metrics I track weekly to grow on X", status: "Draft", date: "—" },
  { id: 2, text: "How I went from 0 to 10K followers in 90 days", status: "Scheduled", date: "Jul 12, 10:00" },
  { id: 3, text: "Stop posting content. Start building trust.", status: "Scheduled", date: "Jul 13, 09:30" },
  { id: 4, text: "5 lessons from shipping 10 indie projects", status: "Published", date: "Jul 10, 08:12", rate: "4.1%", impressions: "18.7K" },
  { id: 5, text: "Thread: my favorite open-source tools in 2026", status: "Published", date: "Jul 8, 07:45", rate: "3.7%", impressions: "22.3K" },
];

const metricData = [
  { label: "Followers", value: "12,842", delta: "5.2%", icon: Users, provenance:undefined },
  { label: "Impressions", value: "1.28M", delta: "18.7%", icon: CircleGauge, provenance:undefined },
  { label: "Engagement rate", value: "3.6%", delta: "0.6pp", icon: Activity, provenance:undefined },
  { label: "Profile visits", value: "24,731", delta: "12.3%", icon: Target, provenance:undefined },
];

function Logo() {
  return <div className="brand-mark" aria-label="OpenX Growth logo"><span>O</span><span>X</span></div>;
}

function DemoGrowthChart({ range }: { range: string }) {
  const paths: Record<string, string> = {
    "7D": "M0 134 C50 130,70 118,105 121 S160 94,205 99 S260 70,315 76 S370 42,430 55 S480 25,530 32 S590 12,640 16",
    "28D": "M0 150 C40 138,65 147,95 128 S145 120,170 110 S220 114,250 96 S300 92,335 68 S390 76,420 54 S470 58,500 37 S555 48,590 23 S620 25,640 14",
    "90D": "M0 155 C55 153,70 132,120 139 S180 116,225 123 S280 99,325 104 S380 77,425 84 S485 60,525 62 S580 30,640 18",
    "1Y": "M0 160 C70 150,75 140,125 143 S190 122,235 124 S300 95,345 103 S405 70,450 77 S510 52,550 60 S600 25,640 15",
  };
  const path = paths[range] ?? paths["28D"];
  return (
    <div className="chart-wrap">
      <div className="chart-y"><span>14K</span><span>13K</span><span>12K</span><span>11K</span><span>10K</span></div>
      <svg className="growth-chart" viewBox="0 0 640 180" preserveAspectRatio="none" role="img" aria-label="Follower growth chart">
        <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b7ff3c" stopOpacity=".22"/><stop offset="1" stopColor="#b7ff3c" stopOpacity="0"/></linearGradient></defs>
        {[20,55,90,125,160].map((y) => <line key={y} x1="0" y1={y} x2="640" y2={y} className="grid-line" />)}
        <path d={`${path} L640 180 L0 180 Z`} fill="url(#area)" />
        <path d={path} className="growth-line" />
        <circle cx="640" cy="14" r="4" fill="#b7ff3c" />
      </svg>
      <div className="chart-x"><span>Jun 14</span><span>Jun 21</span><span>Jun 28</span><span>Jul 5</span><span>Today</span></div>
    </div>
  );
}

function DataSeriesChart({points,label}:{points:Array<{recordedAt:number;value:number}>;label:string}) {
  if(points.length<2)return <div className="live-audience-state"><CircleGauge size={24}/><strong>Insufficient data</strong><p>At least two snapshots in this date range are required to draw {label.toLowerCase()}.</p></div>;
  const values=points.map((point)=>point.value),minimum=Math.min(...values),maximum=Math.max(...values);
  const coordinates=buildChartCoordinates(values);
  return <div className="chart-wrap"><div className="chart-y"><span>{maximum.toLocaleString()}</span><span>{minimum.toLocaleString()}</span></div><svg className="growth-chart" viewBox="0 0 640 180" preserveAspectRatio="none" role="img" aria-label={label}>{[20,55,90,125,160].map((y)=><line key={y} x1="0" y1={y} x2="640" y2={y} className="grid-line"/>)}<polyline points={coordinates} className="growth-line" fill="none"/></svg><div className="chart-x"><span>{new Date(points[0].recordedAt).toLocaleDateString()}</span><span>{new Date(points.at(-1)!.recordedAt).toLocaleDateString()}</span></div></div>;
}

function Composer({ onClose, onSave, onOpenSettings, seed, csrf, evergreenEnabled, aiReady }: { onClose: () => void; onSave: (post:SavePostInput) => Promise<boolean>; onOpenSettings:()=>void;seed:ComposerSeed; csrf:string;evergreenEnabled:boolean;aiReady:boolean }) {
  const [parts,setParts] = useState(seed.parts); const [scheduled,setScheduled]=useState(false); const [scheduledAt,setScheduledAt]=useState(""); const [evergreen,setEvergreen]=useState(false); const [interval,setInterval]=useState(30); const [generated,setGenerated]=useState(seed.generated); const [saving,setSaving]=useState(false); const [activeAi,setActiveAi]=useState<AiRewriteAction|null>(null); const [done,setDone]=useState(false); const [error,setError]=useState("");const [aiError,setAiError]=useState("");
  const aiInFlight=useRef(false);const aiController=useRef<AbortController|null>(null);const hasSource=hasAiRewriteSource(parts);
  useEffect(()=>()=>aiController.current?.abort(),[]);
  const updatePart=(index:number,value:string)=>setParts((current)=>current.map((part,position)=>position===index?value:part));
  const close=()=>{aiController.current?.abort();onClose()};
  const improve=async(action:AiRewriteAction,prompt:string)=>{if(!aiReady||aiInFlight.current)return;const context=parts.join("\n---\n");if(!context.trim()){setAiError("AI_SOURCE_REQUIRED");return}const controller=new AbortController();aiInFlight.current=true;aiController.current=controller;setActiveAi(action);setError("");setAiError("");try{const payload=await requestAiGeneration(csrf,{kind:parts.length>1?"thread":"rewrite",prompt,context},controller.signal);const content=payload.content;setParts(Array.isArray(content)?content:[content]);setGenerated(true)}catch(failure){if(!controller.signal.aborted)setAiError(failure instanceof Error?failure.message:"")}finally{if(aiController.current===controller)aiController.current=null;aiInFlight.current=false;setActiveAi(null)}};
  const submit=async()=>{const clean=parts.map((part)=>part.trim()).filter(Boolean);if(saving||aiInFlight.current||!clean.length||clean.some((part)=>part.length>280))return;setSaving(true);setError("");const ok=await onSave({text:clean[0],thread:clean,scheduledAt:scheduled&&scheduledAt?new Date(scheduledAt).getTime():undefined,evergreen,...(evergreen?{evergreenIntervalDays:interval}:{}),generated,topic:seed.topic,hook:clean[0].split("\n")[0]});setSaving(false);if(ok){setDone(true);setTimeout(close,650)}else setError("Could not save this post.")};
  const guidance=aiError?aiErrorGuidance(aiError):null;
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <section className="composer" onMouseDown={(e) => e.stopPropagation()} aria-modal="true" role="dialog">
        <header><div><span className="eyebrow">COMPOSE</span><h2>Create a post</h2></div><button className="icon-btn" onClick={close}><X size={18}/></button></header>
        <div className="composer-profile"><div className="avatar lime-avatar">YOU</div><div><strong>Your account</strong><span>@connected_account</span></div></div>
        <div className="thread-editor">{parts.map((part,index)=><div className="thread-part" key={index}><span>{index+1}</span><textarea value={part} onChange={(event)=>updatePart(index,event.target.value)} disabled={activeAi!==null} autoFocus={index===0} maxLength={280} placeholder={index===0?"Write your post…":"Continue the thread…"}/><small>{part.length}/280</small>{parts.length>1&&<button disabled={activeAi!==null} onClick={()=>setParts((current)=>current.filter((_,position)=>position!==index))} aria-label={`Remove part ${index+1}`}><X size={13}/></button>}</div>)}</div>
        <div className="composer-toolbar"><button className="outline-btn" disabled={activeAi!==null} onClick={()=>setParts((current)=>[...current,""])}><Plus size={14}/> Add thread post</button>{aiReady&&<div className="ai-tools"><button disabled={saving||activeAi!==null} onClick={()=>void improve("Stronger hook","Write a stronger hook for the provided draft.")}><Sparkles size={14}/> {activeAi==="Stronger hook"?"Stronger hook…":"Stronger hook"}</button><button disabled={saving||activeAi!==null} onClick={()=>void improve("Shorten","Shorten and clarify the provided draft.")}><Zap size={14}/> {activeAi==="Shorten"?"Shorten…":"Shorten"}</button><button disabled={saving||activeAi!==null} onClick={()=>void improve("Match my voice","Match the provided draft to my writing voice.")}><PenLine size={14}/> {activeAi==="Match my voice"?"Match my voice…":"Match my voice"}</button></div>}</div>
        <div className="publish-options"><label><input type="checkbox" checked={scheduled} onChange={(event)=>setScheduled(event.target.checked)}/> Schedule</label>{scheduled&&<input type="datetime-local" value={scheduledAt} onChange={(event)=>setScheduledAt(event.target.value)} min={new Date().toISOString().slice(0,16)}/>} {evergreenEnabled&&<><label><input type="checkbox" checked={evergreen} onChange={(event)=>setEvergreen(event.target.checked)}/> Evergreen</label>{evergreen&&<label>Repeat every <input type="number" min="7" value={interval} onChange={(event)=>setInterval(Number(event.target.value))}/> days</label>}</>}</div>
        {generated&&<div className="generated-notice"><Sparkles size={13}/> AI-generated suggestion — review every part before publishing.</div>}{guidance&&<div className="inline-error" role="alert">{guidance.message}{guidance.openSettings&&<button className="text-btn" onClick={onOpenSettings}>Open Settings</button>}</div>}{error&&<div className="inline-error">{error}</div>}
        <footer><button className="ghost-btn" onClick={close}>Cancel</button><button className="primary-btn" onClick={submit} disabled={saving||activeAi!==null||!hasSource}>{done?<><Check size={16}/> Saved</>:saving?"Saving…":scheduled?<><CalendarDays size={16}/> Schedule</>:<><FileText size={16}/> Save draft</>}</button></footer>
      </section>
    </div>
  );
}

function ReplyComposer({ opportunity, live, onClose, csrf, aiRepliesApproved, onFeedback }: { opportunity: ReplyOpportunity; live: boolean; onClose: () => void; csrf:string; aiRepliesApproved:boolean; onFeedback:(vote:number)=>void }) {
  const [text,setText] = useState(opportunity.suggestedReply);
  const [sending,setSending] = useState(false);
  const [result,setResult] = useState<"sent"|"error"|null>(null);
  const [generated,setGenerated]=useState(Boolean(opportunity.suggestedReply));
  const suggest=async()=>{setSending(true);setResult(null);try{const payload=await requestAiGeneration(csrf,{kind:"reply",prompt:"Draft a useful, specific reply for human review",context:opportunity.post});if(typeof payload.content!=="string")throw new Error("AI_INVALID_RESPONSE");setText(payload.content);setGenerated(true)}catch{setResult("error")}finally{setSending(false)}};
  const send = async () => {
    if (!live) { window.open(opportunity.url,"_blank","noopener,noreferrer"); return; }
    setSending(true); setResult(null);
    const response = await fetch("/api/x/reply",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({postId:opportunity.id,text,generated})});
    setSending(false); setResult(response.ok ? "sent" : "error");
    if (response.ok) setTimeout(onClose,800);
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="composer reply-composer" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Write reply"><header><div><span className="eyebrow">REPLY TO {opportunity.handle.toUpperCase()}</span><h2>Join the conversation</h2></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></header><div className="quoted-post"><strong>{opportunity.name} <small>{opportunity.handle}</small></strong><p>{opportunity.post}</p><em>{opportunity.reason}</em></div><label className="reply-label">YOUR REPLY<textarea value={text} onChange={(event)=>{setText(event.target.value);if(!event.target.value)setGenerated(false)}} maxLength={280} placeholder="Write a specific, useful reply…"/></label>{aiRepliesApproved&&<button className="outline-btn ai-reply-btn" onClick={suggest} disabled={sending}><Sparkles size={14}/> Suggest with AI</button>}{generated&&<div className="generated-notice"><Sparkles size={13}/> AI-generated suggestion — edit and review before publishing.</div>}<div className="composer-meta"><span>{text.length}/280</span><span>{live?"Publishes only after your confirmation":"Demo mode · opens the post on X"}</span></div><div className="feedback-actions"><span>Was this opportunity relevant?</span><button onClick={()=>onFeedback(1)}>👍</button><button onClick={()=>onFeedback(-1)}>👎</button></div>{result==="error"&&<div className="inline-error">The action failed. Check approval, permissions and connection status.</div>}<footer><button className="ghost-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={send} disabled={sending||!text.trim()}>{result==="sent"?<><Check size={15}/> Sent</>:sending?"Sending…":live?<><Send size={15}/> Publish reply</>:<><ArrowUpRight size={15}/> Open on X</>}</button></footer></section></div>;
}

const X_DEV_CONSOLE = "https://console.x.com/";
const OPENROUTER_KEYS = "https://openrouter.ai/keys";

function CopyField({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <label className="callback-field">
      {label}
      <div className="copy-input">
        <input readOnly value={value} />
        <button type="button" onClick={() => void navigator.clipboard.writeText(value)} aria-label={`Copy ${label}`}><Link2 size={15}/></button>
      </div>
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

const apiSetupSteps = [
  { label: "Install OpenX", icon: Github },
  { label: "Create an X app", icon: Code2 },
  { label: "Register app URLs", icon: Settings },
  { label: "Authorize X", icon: Link2 },
];

function SetupGuide({ onClose, onGoToSettings, onGoToCredits }: { onClose: () => void; onGoToSettings: () => void; onGoToCredits: () => void }) {
  const [step, setStep] = useState(0);
  const [origin] = useState(() => (typeof window === "undefined" ? "https://your-domain.com" : window.location.origin));
  const callback = `${origin}/api/x/oauth/callback`;
  const finish = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    onGoToSettings();
  };
  return <div className="modal-backdrop onboarding-backdrop">
    <section className="setup-guide" aria-modal="true" role="dialog" aria-label="Connect X API setup guide">
      <aside className="setup-progress">
        <div className="brand"><Logo/><span>OpenX Growth</span></div>
        <div><span className="eyebrow">QUICK START</span><h2>Finish your setup</h2><p>One guided installation, then connect your own X application.</p></div>
        <ol>{apiSetupSteps.map(({label,icon:Icon}, index) => <li key={label} className={index === step ? "current" : index < step ? "complete" : ""}><i>{index < step ? <Check size={13}/> : <Icon size={13}/>}</i><span><small>STEP {index+1}</small>{label}</span></li>)}</ol>
        <div className="byok-note"><Github size={16}/><div><strong>Why your own X app?</strong><p>You control authorization, API usage and billing in your X developer account.</p><button className="text-btn" onClick={onGoToCredits}>Understand credits and local limits</button></div></div>
      </aside>
      <div className="setup-content">
        <header><span className="step-count">{step+1} / {apiSetupSteps.length}</span><button className="icon-btn" onClick={onClose} aria-label="Close setup"><X size={18}/></button></header>
        {step === 0 && <div className="setup-step"><div className="step-icon"><Github size={23}/></div><span className="eyebrow">GUIDED INSTALLATION</span><h1>Run one installer</h1><p className="lead">The terminal wizard creates the Cloudflare app, database, migrations and installation secrets for you. Do not repeat those steps manually.</p><div className="instruction-list"><div><b>1</b><p><strong>Fork and clone OpenX</strong><span>Keep your fork private while the installation is being configured.</span></p></div><div><b>2</b><p><strong>Run the two commands</strong><span><code>npm ci</code>, then <code>npm run setup</code>.</span></p></div><div><b>3</b><p><strong>Accept the simple defaults</strong><span>Approve the Cloudflare browser login and press Enter for the recommended workers.dev address. You can defer X credentials until Settings.</span></p></div><div><b>4</b><p><strong>Wait for “Setup complete”</strong><span>Open the printed address and sign in with APP_ACCESS_TOKEN from your local .env.local. If you are already viewing your deployed OpenX app, continue to the next step.</span></p></div></div><div className="security-note"><Check size={16}/><p><strong>The installer does the technical work.</strong><span>Do not copy .env.example, generate secrets or run migrations separately unless you are following the advanced recovery guide.</span></p></div><a className="external-action" href="https://github.com/dg996/OpenX-Growth#first-installation-recommended" target="_blank" rel="noreferrer">Read the installation guide <ArrowUpRight size={15}/></a></div>}
        {step === 1 && <div className="setup-step"><div className="step-icon"><Code2 size={23}/></div><span className="eyebrow">X DEVELOPER CONSOLE</span><h1>Create your X application</h1><p className="lead">You never paste an X access token manually. OpenX uses OAuth 2.0 + PKCE and stores encrypted tokens after you approve in the browser.</p><div className="instruction-list"><div><b>1</b><p><strong>Open the X Developer Console</strong><span>Create a project and a dedicated app named e.g. “OpenX Growth”.</span></p></div><div><b>2</b><p><strong>Enable OAuth 2.0</strong><span>Under User authentication settings, turn on OAuth 2.0.</span></p></div><div><b>3</b><p><strong>App type: Web App / Single Page App</strong><span>Public clients use PKCE and usually do not need a client secret.</span></p></div><div><b>4</b><p><strong>Set permissions to Read and Write</strong><span>Required for sync, publishing and replies.</span></p></div><div><b>5</b><p><strong>Copy the OAuth 2.0 Client ID</strong><span>Paste it into <strong>Settings → X account</strong>. If X gives you a Client Secret, paste that there too.</span></p></div></div><a className="external-action" href={X_DEV_CONSOLE} target="_blank" rel="noreferrer">Open X Developer Console <ArrowUpRight size={15}/></a><div className="security-note"><Settings size={16}/><p><strong>Dedicated app recommended.</strong><span>Isolates permissions, billing and revocation from your other X integrations.</span></p></div></div>}
        {step === 2 && <div className="setup-step"><div className="step-icon"><Settings size={23}/></div><span className="eyebrow">APPLICATION URLS</span><h1>Register these two addresses</h1><p className="lead">The guided terminal setup already creates the installation secrets. Here you only copy the public addresses into your X application.</p><div className="config-grid"><label className="wide">Website URL<strong>{origin}</strong><small>Use this as the Website URL in the X Developer Console.</small></label><label className="wide">Callback / Redirect URI<div className="copy-code"><code>{callback}</code><button onClick={()=>void navigator.clipboard.writeText(callback)} aria-label="Copy callback URL"><Link2 size={14}/></button></div><small>Paste this exact URL into the X app OAuth settings. It must match character-for-character.</small></label></div><div className="security-note"><Settings size={16}/><p><strong>Everything else is in Settings.</strong><span>X credentials, OpenRouter or OpenAI, publishing options, limits and integration keys are managed from the application.</span></p></div><div className="scope-box"><strong>OAuth scopes OpenX requests</strong><div><code>tweet.read</code><code>tweet.write</code><code>users.read</code><code>offline.access</code></div><p><code>offline.access</code> provides a refresh token so sync and publishing keep working without re-login.</p></div></div>}
        {step === 3 && <div className="setup-step"><div className="step-icon"><Link2 size={23}/></div><span className="eyebrow">AUTHORIZE</span><h1>Connect your X account</h1><p className="lead">Open <strong>Settings → X account</strong>, paste the Client ID, save, then click <strong>Continue with X</strong>. You will review permissions on X and return here automatically.</p><div className="instruction-list"><div><b>1</b><p><strong>Save the X application</strong><span>Enter the OAuth Client ID and optional Client Secret directly in Settings.</span></p></div><div><b>2</b><p><strong>Click Continue with X</strong><span>Starts OAuth with PKCE and redirects you to X.</span></p></div><div><b>3</b><p><strong>Approve on X</strong><span>X returns a one-time authorization code to <code>{callback}</code>.</span></p></div><div><b>4</b><p><strong>Go to Discover → Sync from X</strong><span>Live ideas, reply opportunities and analytics replace demo data.</span></p></div></div><div className="security-note"><Zap size={16}/><p><strong>No manual access-token entry.</strong><span>OAuth tokens are encrypted and never shown. Disconnect in Settings deletes the stored authorization.</span></p></div><button className="primary-btn finish-setup" onClick={finish}>Open Settings <ArrowUpRight size={15}/></button></div>}
        <footer><button className="ghost-btn" onClick={onClose}>I&apos;ll do this later</button><div><button className="outline-btn" disabled={step === 0} onClick={() => setStep((value) => Math.max(0,value-1))}>Back</button>{step < apiSetupSteps.length-1 && <button className="primary-btn" onClick={() => setStep((value) => value+1)}>Continue <ArrowUpRight size={14}/></button>}</div></footer>
      </div>
    </section>
  </div>;
}

function WorkspaceStatePanel({state,onSettings}:{state:"loading"|"configured-disconnected";onSettings:()=>void}) {
  const content={
    loading:{title:"Loading workspace",body:"Checking the protected configuration and X connection before showing data."},
    "configured-disconnected":{title:"Connect X to continue",body:"This instance is configured, but no X account is currently authorized."},
  }[state];
  return <section className="panel full-panel workspace-state" role="status"><CircleGauge size={28}/><h2>{content.title}</h2><p>{content.body}</p><div>{state==="configured-disconnected"&&<button className="primary-btn" onClick={onSettings}>Open Settings</button>}</div></section>;
}

function WorkspaceSyncNotice({state,error,onRetry,onSettings,onDiscover,onCredits}:{state:WorkspaceState;error:string;onRetry:()=>void;onSettings:()=>void;onDiscover:()=>void;onCredits:()=>void}) {
  if(state==="unconfigured-demo"||state==="configured-disconnected"||state==="live"||isWorkspaceBlocking(state))return null;
  if(state==="connected-syncing"||state==="live-refreshing")return <section className="workspace-sync-notice" role="status"><CircleGauge size={17}/><div><strong>{state==="live-refreshing"?"Refreshing X data":"First X sync in progress"}</strong><span>{state==="live-refreshing"?"Existing verified data stays available while the read-only refresh runs.":"Local features stay available while OpenX loads the first verified snapshots."}</span></div></section>;
  if(state==="connected-insufficient")return <section className="workspace-sync-notice" role="status"><CircleGauge size={17}/><div><strong>No verified X data yet</strong><span>Open Discover when you are ready to run a read-only sync. Drafts and schedules remain available.</span></div><button className="outline-btn" onClick={onDiscover}>Open Discover</button></section>;
  const guidance=syncErrorGuidance(error);
  return <section className="workspace-sync-notice error" role="alert"><CircleGauge size={17}/><div><strong>{guidance.title}</strong><span>{guidance.body}</span></div>{guidance.retryable&&<button className="outline-btn" onClick={onRetry}>Retry sync</button>}{guidance.manageLimits?<button className="outline-btn" onClick={onCredits}>Open Settings → Limits</button>:<button className="outline-btn" onClick={onSettings}>Open Settings</button>}</section>;
}

function SchemaRecovery({code}:{code:string}) {
  const outdated=code==="LOCAL_DATABASE_OUTDATED";
  return <section className="panel full-panel workspace-state" role="alert"><CircleGauge size={28}/><h2>Database setup required</h2><p>{outdated?"The local database schema is outdated.":"The local database is not ready."} Apply the existing D1 migrations through 0003_rainy_juggernaut.sql, restart OpenX, then try again.</p><details><summary>View migration steps</summary><code>npm run db:migrate:local</code><code>npm run db:migrate:remote</code></details></section>;
}

function XStatusSurface({status,syncing,notice,error,compact=false,onSync,onReconnect,onSettings,onCredits}:{status:AppRuntimeConfig;syncing:boolean;notice?:string;error?:string;compact?:boolean;onSync:()=>void;onReconnect:()=>void;onSettings:()=>void;onCredits:()=>void}) {
  const authorization=status.authorization?.state??"disconnected",sync=status.sync,usage=status.usage,readiness=status.readiness;
  const busy=syncing||sync?.state==="in_progress";
  const originMismatch=status.origin?.configured===true&&!status.origin.currentMatchesCanonical;
  const budgetBlocked=!busy&&sync?.next.enabled===false;
  const resetLabel=localResetLabel(usage?.resetsAt);
  let title="X is ready to connect",body="Authorize the account this instance will use.";
  if(originMismatch){title="Use the configured OpenX address";body="This address does not match APP_URL, so X authorization was not started.";}
  else if(authorization==="reconnect_required"){title="Reconnect X";body="OpenX could not renew access. Reconnect keeps your verified data.";}
  else if(busy){title="Syncing X data";body="Existing local data remains available. No X writes are being made.";}
  else if(sync?.state==="budget_exhausted"||budgetBlocked){title="OpenX daily safety limit reached";body=`OpenX has counted ${usage?.usedResources??0} of ${usage?.maxResources??0} returned X data items today. This local cap is separate from your paid X Developer Credits.`;}
  else if(authorization==="authorization_check_required"){title="Authorization needs a check";body="Sync will first try to renew access. No X writes will be made.";}
  else if(sync?.cacheAvailable){title=readiness?.overall==="sufficient"?"X data is up to date":"Sync complete, limited data";body=readiness?.overall==="sufficient"?`Last synced ${sync.lastSuccessfulAt?new Date(sync.lastSuccessfulAt).toLocaleString():"recently"}.`:"The data is valid, but not every feature has enough evidence yet.";}
  else if(authorization==="connected"){title="X authorized";body="Review the local read estimate, then sync when ready.";}
  const canSync=(authorization==="connected"||authorization==="authorization_check_required")&&!busy&&!budgetBlocked;
  return <section className={`panel x-status-surface ${compact?"compact":"detailed"}`} role="status" aria-labelledby="x-status-heading">
    <div className="x-status-copy"><span className="eyebrow">X CONNECTION AND SYNC</span><h2 id="x-status-heading" tabIndex={-1}>{title}</h2><p>{body}</p>{notice&&<div className="x-status-alert" role="alert">{notice}</div>}{error&&<div className="x-status-alert" role="alert">{syncErrorGuidance(error).body}</div>}</div>
    <dl className="x-status-facts"><div><dt>Authorization</dt><dd>{authorization.replaceAll("_"," ")}</dd></div><div><dt>Last successful sync</dt><dd>{sync?.lastSuccessfulAt?new Date(sync.lastSuccessfulAt).toLocaleString():"Never"}</dd></div><div><dt>Data</dt><dd>{sync?.freshness==="cached_stale"?"Cached, may be stale":sync?.cacheAvailable?readiness?.overall==="sufficient"?"Cached":"Limited":"Unavailable"}</dd></div>{usage&&<div><dt>OpenX daily safety cap</dt><dd>{usage.usedResources} of {usage.maxResources} returned data items used · {usage.availableResources} available <button className="inline-link" onClick={onCredits}>Manage</button></dd></div>}{sync&&<div><dt>{busy?"Active sync":budgetBlocked?"Why sync is paused":"Next sync"}</dt><dd>{budgetBlocked?`A complete sync needs at least 11 available data items; ${usage?.availableResources??0} remain.`:`Up to ${busy?(sync.activeMaxReadResources??sync.next.maxReadResources):sync.next.maxReadResources} returned data items · ${busy?(sync.activeMaxRequests??sync.next.maxRequests):sync.next.maxRequests} X API requests · 0 writes`}</dd></div>}</dl>
    <div className="x-status-actions">{originMismatch?<button className="outline-btn" onClick={onSettings}>Review application address</button>:authorization==="reconnect_required"?<button className="primary-btn" onClick={onReconnect} disabled={busy}>Reconnect X</button>:authorization==="disconnected"?<a className={`primary-btn ${!status.configured?"disabled":""}`} href={status.configured?"/api/x/oauth/start":"#"}><Link2 size={15}/> Continue with X</a>:<button className="primary-btn" onClick={onSync} disabled={!canSync} aria-describedby={budgetBlocked?"x-budget-explanation":undefined}>{budgetBlocked?"Sync paused — local limit reached":busy?"Syncing…":authorization==="authorization_check_required"?"Check and sync":sync?.cacheAvailable?"Sync again":"Sync X data"}</button>}{budgetBlocked&&<div className="x-budget-explanation" id="x-budget-explanation"><strong>Not your X Credits balance</strong><span>No additional X API request will be sent while paused. OpenX&apos;s local counter resets automatically every day. Next reset: {resetLabel}.</span><button className="text-btn" onClick={onCredits}>Open Settings → Limits</button></div>}</div>
    {busy&&<div className="x-sync-progress" role="status">OpenX sets aside up to {sync?.activeMaxReadResources??sync?.next.maxReadResources??0} reads while this sync runs. Unused capacity becomes available again when it finishes.</div>}
  </section>;
}

function TodaysGrowthPlan({ideas,opportunities,source,aiReady,csrf,onCreate,onReply,onSettings,onDiscover}:{ideas:IdeaSignal[];opportunities:ReplyOpportunity[];source:"demo"|"live";aiReady:boolean;csrf:string;onCreate:(seed:ComposerSeed)=>void;onReply:(opportunity:ReplyOpportunity)=>void;onSettings:()=>void;onDiscover:()=>void}) {
  const plan=useMemo(()=>buildGrowthPlan(ideas,opportunities),[ideas,opportunities]);
  const [format,setFormat]=useState<"post"|"thread">("post");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const inFlight=useRef(false);
  const guidance=error?aiErrorGuidance(error):null;
  const contentEmpty=growthPlanEmptyGuidance("content");
  const repliesEmpty=growthPlanEmptyGuidance("replies");

  const generate=async()=>{
    if(inFlight.current||!aiReady||!plan.content)return;
    const selectedIdea=plan.content;
    const selectedFormat=format;
    inFlight.current=true;setBusy(true);setError("");
    try{
      const payload=await requestAiGeneration(csrf,{
        kind:selectedFormat,
        prompt:selectedFormat==="post"?"Write one complete X post from this content idea.":"Write an X thread of 3 to 5 parts from this content idea.",
        context:`Topic: ${selectedIdea.topic}\nHook: ${selectedIdea.hook}\nPillar: ${selectedIdea.pillar}\nReason: ${selectedIdea.rationale}`,
      });
      const parts=Array.isArray(payload.content)?payload.content:[payload.content];
      onCreate({parts,topic:selectedIdea.topic,generated:true});
    }catch(failure){setError(failure instanceof Error?failure.message:"")}
    finally{inFlight.current=false;setBusy(false)}
  };

  return <section className="panel growth-plan-panel" aria-labelledby="growth-plan-title">
    <div className="panel-header growth-plan-header"><div><span className="eyebrow">NEXT ACTION</span><h2 id="growth-plan-title">Today&apos;s Growth Plan <DataBadge source={source}/></h2><p>One content move and the strongest conversations from the data already loaded.</p></div></div>
    <div className="growth-plan-grid">
      <section className="growth-plan-content" aria-label="Content action">
        <span className="eyebrow">CREATE</span>
        {plan.content?<>
          <div className="growth-plan-title-row"><h3>{plan.content.topic}</h3><strong>{plan.content.score}</strong></div>
          <p className="growth-plan-hook">{plan.content.hook}</p>
          <p className="growth-plan-rationale">{plan.content.rationale}</p>
          <div className="growth-plan-provenance"><span>Algorithm: {plan.content.algorithmVersion??(source==="demo"?"demo sample":"not available")}</span><DataBadge source={plan.content.scoreProvenance.source}/></div>
          {source==="demo"
            ? <div className="growth-plan-actions"><button className="outline-btn" onClick={()=>onCreate(buildGrowthPlanDraftSeed(plan.content!))}><PenLine size={14}/> Create draft</button><button className="primary-btn" onClick={onSettings}><Link2 size={14}/> Connect X</button></div>
            : <div className="growth-plan-actions">
                <button className="outline-btn" onClick={()=>onCreate(buildGrowthPlanDraftSeed(plan.content!))}><PenLine size={14}/> Create draft</button>
                {aiReady?<>
                  <div className="growth-plan-formats" role="group" aria-label="AI draft format"><button aria-pressed={format==="post"} disabled={busy} onClick={()=>setFormat("post")}>Post</button><button aria-pressed={format==="thread"} disabled={busy} onClick={()=>setFormat("thread")}>Thread</button></div>
                  <button className="primary-btn" onClick={()=>void generate()} disabled={busy}><Sparkles size={14}/> {busy?"Generating…":"Generate with AI"}</button>
                </>:<div className="growth-plan-ai-off"><span>AI drafting is off</span><button className="text-btn" onClick={onSettings}>Open Settings</button></div>}
              </div>}
          {guidance&&<div className="inline-error growth-plan-error" role="alert">{guidance.message}{guidance.openSettings&&<button className="text-btn" onClick={onSettings}>Open Settings</button>}</div>}
        </>:<div className="growth-plan-empty"><strong>{contentEmpty.title}</strong><p>{contentEmpty.body}</p><button className="outline-btn" onClick={onDiscover}>Open Discover</button></div>}
      </section>
      <section className="growth-plan-replies" aria-label="Reply actions">
        <span className="eyebrow">ENGAGE</span>
        {plan.replies.length?plan.replies.map((reply)=><article className="growth-plan-reply" key={reply.id}><div><strong>{reply.name}<small>{reply.handle}</small></strong><p>{reply.post}</p><span>{reply.relevance}% relevance · {reply.reason}</span></div>{source==="live"&&<button className="outline-btn" onClick={()=>onReply(reply)}><MessageCircle size={14}/> Reply</button>}</article>):<div className="growth-plan-empty"><strong>{repliesEmpty.title}</strong><p>{repliesEmpty.body}</p><button className="outline-btn" onClick={onDiscover}>Open Discover</button></div>}
      </section>
    </div>
  </section>;
}

export default function HomePage() {
  const [view, setView] = useState<View>("Overview");
  const [settingsSection,setSettingsSection]=useState<SettingsSection>("x");
  const [range, setRange] = useState("28D");
  const [search, setSearch] = useState("");
  const [composerSeed, setComposerSeed] = useState<ComposerSeed|null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [contentFilter, setContentFilter] = useState("All");
  const [connected, setConnected] = useState(false);
  const [statusLoaded,setStatusLoaded]=useState(false);
  const [setupGuide, setSetupGuide] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unread, setUnread] = useState(3);
  const [opportunityData, setOpportunityData] = useState<ReplyOpportunity[]>([]);
  const [signalData, setSignalData] = useState<IdeaSignal[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const syncInFlight=useRef(false);
  const [lastSync, setLastSync] = useState<string>();
  const [schemaError,setSchemaError]=useState<"LOCAL_DATABASE_NOT_INITIALIZED"|"LOCAL_DATABASE_OUTDATED"|"LOCAL_DATABASE_UNAVAILABLE"|"">("");
  const [loadError,setLoadError]=useState("");
  const [oauthNotice,setOauthNotice]=useState("");
  const [selectedReply, setSelectedReply] = useState<ReplyOpportunity>();
  const [csrf,setCsrf]=useState("");
  const [runtimeConfig,setRuntimeConfig]=useState<AppRuntimeConfig>({configured:false,demoMode:true,accessProtected:false,aiConfigured:false,aiContentApproved:false,aiRepliesApproved:false,evergreenEnabled:false,syncTtlSeconds:900});
  const [analytics,setAnalytics]=useState<AnalyticsData>();
  const [account,setAccount]=useState<AccountProfile>();
  useEffect(() => {
    const storedTheme = localStorage.getItem("openx-theme") as "dark" | "light" | null;
    const preferredTheme = storedTheme ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    // Client-only preferences after mount — avoids SSR/localStorage hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount read
    setTheme(preferredTheme);
    document.documentElement.dataset.theme = preferredTheme;
    setPreferencesReady(true);
  }, []);
  useEffect(() => {
    if (!preferencesReady) return;
    document.documentElement.dataset.theme = theme;
  }, [theme, preferencesReady]);
  useEffect(() => {
    void (async()=>{
      try{
        const statusResponse=await fetch("/api/x/status",{cache:"no-store"});
        if(statusResponse.status===401){window.location.href="/login";return}
        if(statusResponse.status===503){const failure=await statusResponse.json().catch(()=>({})) as {error?:string};if(failure.error==="LOCAL_DATABASE_NOT_INITIALIZED"||failure.error==="LOCAL_DATABASE_OUTDATED"||failure.error==="LOCAL_DATABASE_UNAVAILABLE"){setSchemaError(failure.error);setRuntimeConfig((current)=>({...current,configured:true,demoMode:false}));}else setLoadError("OpenX could not load this workspace. Retry local loading.");setStatusLoaded(true);return;}
        if(!statusResponse.ok){setLoadError("OpenX could not load this workspace. Retry local loading.");setStatusLoaded(true);return;}
        const status=await statusResponse.json() as RuntimeStatus;
        const [csrfResponse,postsResponse,analyticsPayload,cachePayload]=await Promise.all([fetch("/api/security/csrf"),fetch("/api/posts"),fetchAnalyticsData("28D"),fetchXCache()]);
        if(csrfResponse.ok)setCsrf(((await csrfResponse.json()) as {token:string}).token);
        if(postsResponse.ok){const payload=await postsResponse.json() as PostsPayload;setContent(status.demoMode?initialContent:payload.posts.map((post)=>({id:post.id,text:post.text,status:postStatusLabel(post.status),date:post.scheduledAt?new Date(post.scheduledAt).toLocaleString():post.publishedAt?new Date(post.publishedAt).toLocaleString():"—",evergreen:post.evergreen,lastError:post.lastError})))}
        if(analyticsPayload)setAnalytics(analyticsPayload);
        const isConnected=Boolean(status.connected);
        const hasAuthorizationContext=status.authorization?.state!=="disconnected";
        const onboarding=decideOnboarding({statusLoaded:true,connected:hasAuthorizationContext,dismissed:localStorage.getItem(ONBOARDING_STORAGE_KEY)==="true"});
        if(onboarding.persistComplete)localStorage.setItem(ONBOARDING_STORAGE_KEY,"true");
        setSetupGuide(onboarding.open);
        setConnected(isConnected);setRuntimeConfig(status);setStatusLoaded(true);
        if(status.demoMode){setOpportunityData(opportunities);setSignalData(signals)}
        else {setOpportunityData([]);setSignalData([])}
        if(cachePayload.available&&cachePayload.data){const payload=cachePayload.data;setAccount(payload.account);setOpportunityData(payload.opportunities);setSignalData(payload.ideas);setLastSync(payload.syncedAt);}
        const query=new URLSearchParams(window.location.search);const connectedResult=query.get("x_connected"),oauthError=query.get("x_error");
        if(connectedResult==="1")setOauthNotice("X authorized. Review the local read estimate, then sync when ready.");
        else if(oauthError==="origin_mismatch")setOauthNotice("OpenX cannot start X authorization from this address. Open the address configured as APP_URL.");
        else if(oauthError)setOauthNotice("X authorization could not be verified. Nothing was replaced.");
        if(connectedResult||oauthError){query.delete("x_connected");query.delete("x_error");window.history.replaceState({},"",`${window.location.pathname}${query.size?`?${query}`:""}${window.location.hash}`);setTimeout(()=>document.getElementById("x-status-heading")?.focus(),0);}
      }catch{setLoadError("OpenX could not load this workspace. Retry local loading.");setStatusLoaded(true);}
    })();
  }, []);

  const loadPosts=async()=>{const response=await fetch("/api/posts");if(!response.ok)return;const payload=await response.json() as PostsPayload;setContent(payload.posts.map((post)=>({id:post.id,text:post.text,status:postStatusLabel(post.status),date:post.scheduledAt?new Date(post.scheduledAt).toLocaleString():post.publishedAt?new Date(post.publishedAt).toLocaleString():"—",evergreen:post.evergreen,lastError:post.lastError})))};
  const loadAnalytics=async(nextRange=range)=>{const payload=await fetchAnalyticsData(nextRange);if(payload)setAnalytics(payload)};
  const savePost=async(input:SavePostInput)=>{const response=await fetch("/api/posts",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(input)});if(response.ok){await loadPosts();return true}return false};
  const publishPost=async(id:string|number)=>{const response=await fetch(`/api/posts/${id}/publish`,{method:"POST",headers:{"X-CSRF-Token":csrf}});await loadPosts();if(response.ok)await loadAnalytics();return response.ok};
  const sendFeedback=async(type:"idea"|"reply",id:string,vote:number,context:unknown)=>{await fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({targetType:type,targetId:id,vote,context})})};

  const refreshRuntimeStatus=async()=>{const response=await fetch("/api/x/status",{cache:"no-store"});if(response.ok){const status=await response.json() as RuntimeStatus;setRuntimeConfig(status);setConnected(status.connected);return status}return null};
  const syncFromX = async () => {
    if(syncInFlight.current||syncing||!csrf)return;
    syncInFlight.current=true;
    setSyncing(true); setSyncError("");
    try {
      const payload=await postXSync(csrf,crypto.randomUUID());
      setAccount(payload.account); setOpportunityData(payload.opportunities); setSignalData(payload.ideas); setLastSync(payload.syncedAt); setConnected(true); await loadAnalytics();
    } catch (error) {
      setSyncError(sanitizeSyncError(error instanceof Error?error.message:error));
    } finally { await refreshRuntimeStatus();setSyncing(false);syncInFlight.current=false; }
  };

  const reconnectX=async()=>{if(syncing)return;const response=await fetch("/api/x/disconnect",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({intent:"reconnect"})});if(response.ok){const payload=await response.json() as {next:string};window.location.assign(payload.next)}else setSyncError("X_RECONNECT_REQUIRED")};

  const mutateUsageControls=async(body:Record<string,unknown>,successMessage:string):Promise<UsageControlResult>=>{
    if(!csrf)return {ok:false,message:"Usage controls are not ready yet. Reload the page and try again."};
    try{
      const response=await fetch("/api/x/status",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(body)});
      if(!response.ok){const failure=await response.json().catch(()=>({})) as {error?:string};return {ok:false,message:failure.error==="SYNC_ALREADY_IN_PROGRESS"?"A sync or another usage change is already running. Try again when it finishes.":"OpenX could not update the local usage controls."};}
      await Promise.all([refreshRuntimeStatus(),loadAnalytics()]);
      return {ok:true,message:successMessage};
    }catch{return {ok:false,message:"OpenX could not update the local usage controls."};}
  };
  const resetLocalUsage=()=>mutateUsageControls({intent:"reset_local_usage"},"Today's OpenX counters were reset. Your saved caps and provider balances were not changed.");
  const saveUsageLimits=(limits:{maxResources:number;maxSyncResources:number;maxWrites:number})=>mutateUsageControls({intent:"set_local_usage_limits",...limits},"Your OpenX safety caps were saved.");

  const openComposer = (seed:ComposerSeed={parts:[""],generated:false}) => { setComposerSeed(seed); };
  const dismissOnboarding=()=>{localStorage.setItem(ONBOARDING_STORAGE_KEY,"true");setSetupGuide(false)};
  const filteredSignals = signalData.filter((signal) => signal.topic.toLowerCase().includes(search.toLowerCase()));
  const visibleContent = content.filter((item) => contentFilter === "All" || item.status === contentFilter);

  const filteredOpportunities = useMemo(() => opportunityData.filter((item) => `${item.name} ${item.post}`.toLowerCase().includes(search.toLowerCase())), [search,opportunityData]);

  const changeView = (next: View) => { setView(next); setSearch(""); };
  const openSettings=(section:SettingsSection="x")=>{setSettingsSection(section);changeView("Settings")};
  const dataSource:"demo"|"live"=runtimeConfig.demoMode?"demo":"live";
  const aiReady=isAiContentReady(runtimeConfig);
  const hasLiveData=hasLivePlanningData({hasAccountProfile:Boolean(account),ideaCount:signalData.length,replyOpportunityCount:opportunityData.length,analyticsStatus:analytics?.dataStatus});
  const authorizationPresent=runtimeConfig.authorization?.state!=="disconnected"&&runtimeConfig.authorization?.state!==undefined;
  const syncBusy=syncing||runtimeConfig.sync?.state==="in_progress";
  const workspaceState=resolveWorkspaceState({status:statusLoaded?{configured:runtimeConfig.configured,demoMode:runtimeConfig.demoMode,connected:connected||authorizationPresent}:null,syncing:syncBusy,syncError,lastSync,hasLiveData});
  const changeRange=(next:string)=>{setRange(next);if(dataSource==="live")void loadAnalytics(next)};
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("openx-theme", next);
  };
  const openNotification = (next: View) => {
    changeView(next);
    setNotificationsOpen(false);
  };
  const liveMetrics=dataSource==="live"&&analytics?.dataStatus==="available"?[
    {label:"Published posts",value:String(content.filter((item)=>item.status==="Published").length),delta:"stored records",icon:FileText,provenance:{source:"derived" as const,recordedAt:analytics.range.endAt}},
    {label:"Impressions",value:analytics.derived.totals.impressions.value.toLocaleString(),delta:"selected range",icon:CircleGauge,provenance:analytics.derived.totals.impressions.provenance},
    {label:"Engagement rate",value:`${(analytics.derived.totals.engagementRate.value*100).toFixed(2)}%`,delta:"measured impressions",icon:Activity,provenance:analytics.derived.totals.engagementRate.provenance},
    {label:"OpenX daily safety cap",value:`${analytics.usage.resources}/${analytics.usage.maxResources} items`,delta:analytics.usage.warning?`Local cap reached · ${analytics.usage.remainingResources} data items available today`:`${analytics.usage.requests} X API requests · ${analytics.usage.writes} write attempts · open limits`,icon:Target,provenance:analytics.usage.provenance},
  ]:dataSource==="demo"?metricData:[];
  const notificationItems=[...content.filter((item)=>item.status==="Needs review").slice(0,2).map(()=>({view:"Content" as View,title:"Publishing needs reconciliation",body:"Possible X acceptance was not confirmed locally. Do not retry this post.",time:"Owner review required",icon:Zap})),...content.filter((item)=>item.status==="Failed").slice(0,2).map((item)=>({view:"Content" as View,title:"Publishing failed",body:item.lastError??item.text,time:"Needs attention",icon:Zap})),...content.filter((item)=>item.status==="Scheduled").slice(0,2).map((item)=>({view:"Schedule" as View,title:"Post scheduled",body:item.text,time:item.date,icon:CalendarDays})),...(lastSync?[{view:"Discover" as View,title:"X feed synchronized",body:`Ideas and reply opportunities refreshed from X.`,time:new Date(lastSync).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),icon:Flame}]:[])];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Logo/><span>OpenX Growth</span></div>
        <a className="open-source" href="https://github.com/dg996/OpenX-Growth" target="_blank" rel="noreferrer"><Github size={15}/><span>Open source</span><small>v0.1.0</small></a>
        <nav>
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={view === label ? "active" : ""} onClick={() => changeView(label)}><Icon size={18}/><span>{label}</span>{label === "Discover" && statusLoaded&&runtimeConfig.demoMode&&<i>5</i>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <button className={view === "Settings" ? "active" : ""} onClick={() => changeView("Settings")}><Settings size={18}/><span>Settings</span></button>
          <div className="workspace">{account?.profileImageUrl?<div className="avatar profile-avatar" style={{backgroundImage:`url(${account.profileImageUrl})`}} aria-label={`${account.name} profile image`}/>:<div className="avatar">{account?.name.slice(0,2).toUpperCase()??"YOU"}</div>}<div><strong>{account?.name??"Personal workspace"}</strong><span>{account?`@${account.username} · ${connected?"X":"cached X data"}`:connected?"X connected":runtimeConfig.demoMode?"Demo workspace":"X not connected"}</span></div><ChevronDown size={15}/></div>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="topbar">
          <div><span className="eyebrow">WORKSPACE / {view.toUpperCase()}</span><h1>{view}</h1></div>
          <div className="top-actions">
            <label className="search-box"><Search size={15}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search or type a command…"/><kbd>⌘ K</kbd></label>
            <button className="icon-btn theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={17}/> : <Moon size={17}/>}</button>
            <div className="notification-wrap">
              <button className={`icon-btn ${notificationsOpen ? "is-open" : ""}`} onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications" aria-expanded={notificationsOpen}><Bell size={17}/>{unread > 0 && <span className="notification-dot"/>}</button>
              {notificationsOpen && <div className="notification-panel" role="dialog" aria-label="Notifications panel">
                <header><div><span className="eyebrow">ACTIVITY</span><h2>Notifications</h2></div><button onClick={() => setUnread(0)}>Mark all as read</button></header>
                <div className="notification-list">{notificationItems.length?notificationItems.map(({view:target,title,body,time,icon:Icon},index)=><button key={`${title}-${index}`} onClick={()=>openNotification(target)}><i className="notification-icon"><Icon size={15}/></i><span><strong>{title}</strong><small>{body}</small><em>{time}</em></span>{unread>0&&<b/>}</button>):<div className="empty-state">No notifications.</div>}</div>
                <footer><button onClick={() => { setUnread(0); setNotificationsOpen(false); }}>Clear notifications</button></footer>
              </div>}
            </div>
            <button className="primary-btn" onClick={() => openComposer()}><Plus size={17}/> Create post</button>
          </div>
        </header>

        <div className="page-content">
          {schemaError?<SchemaRecovery code={schemaError}/>:loadError?<section className="panel full-panel workspace-state" role="alert"><CircleGauge size={28}/><h2>OpenX could not load this workspace</h2><p>Retry local loading. No X or AI service was contacted.</p><button className="outline-btn" onClick={()=>window.location.reload()}>Retry local loading</button></section>:view==="Settings"
            ? <SettingsPage selected={settingsSection} onSelect={setSettingsSection} connected={connected} config={runtimeConfig} csrf={csrf} syncing={syncBusy} onSaveLimits={saveUsageLimits} onResetLimits={resetLocalUsage} onRuntimeRefresh={()=>void refreshRuntimeStatus()} onDisconnected={()=>{setConnected(false);setAccount(undefined);setOpportunityData([]);setSignalData([]);setAnalytics(undefined);setLastSync(undefined);setSyncError("");void refreshRuntimeStatus()}} onOpenGuide={() => setSetupGuide(true)}/>
            : isWorkspaceBlocking(workspaceState)
              ? <WorkspaceStatePanel state={workspaceState} onSettings={()=>changeView("Settings")}/>
              : <>
          <XStatusSurface status={runtimeConfig} syncing={syncBusy} notice={oauthNotice} error={syncError} compact onSync={()=>void syncFromX()} onReconnect={()=>void reconnectX()} onSettings={()=>openSettings("x")} onCredits={()=>openSettings("limits")}/>
          <WorkspaceSyncNotice state={workspaceState} error={syncError} onRetry={()=>void syncFromX()} onSettings={()=>openSettings("x")} onDiscover={()=>changeView("Discover")} onCredits={()=>openSettings("limits")}/>
          {view === "Overview" && <>
            <TodaysGrowthPlan ideas={signalData} opportunities={opportunityData} source={dataSource} aiReady={aiReady} csrf={csrf} onCreate={openComposer} onReply={setSelectedReply} onSettings={()=>changeView("Settings")} onDiscover={()=>changeView("Discover")}/>
            {liveMetrics.length?<section className="metrics-row">
              {liveMetrics.map(({ label, value, delta, icon: Icon,provenance }) => label==="OpenX daily safety cap"?<button className="metric-card metric-card-link" key={label} onClick={()=>openSettings("limits")}><div><span>{label}</span><strong>{value}</strong><small><ArrowUpRight size={12}/>{delta}<em>{provenance?<ProvenanceText provenance={provenance}/>:"demo data"}</em></small></div><div className="metric-icon"><Icon size={18}/></div></button>:<article className="metric-card" key={label}><div><span>{label}</span><strong>{value}</strong><small><ArrowUpRight size={12}/>{delta}<em>{provenance?<ProvenanceText provenance={provenance}/>:"demo data"}</em></small></div><div className="metric-icon"><Icon size={18}/></div></article>)}
            </section>:<section className="panel full-panel empty-analytics"><BarChart3 size={28}/><h2>Insufficient analytics data</h2><p>No verified X snapshots are available in the selected range yet.</p></section>}

            <section className="overview-grid">
              <article className="panel growth-panel">
                {dataSource === "live" ? <>
                  <div className="panel-header"><div><span className="eyebrow">AUDIENCE</span><h2>Follower history</h2></div><DataBadge source="live"/></div>
                  <div className="chart-summary"><strong>{(account?.followersCount??analytics?.followers.series.at(-1)?.followers.value)?.toLocaleString() ?? "—"}</strong><span><Check size={13}/> {lastSync?`Synced from X ${new Date(lastSync).toLocaleString()}`:"Stored X snapshots"}</span></div>
                  <DataSeriesChart label="Follower snapshots" points={(analytics?.followers.series??[]).map((point)=>({recordedAt:point.recordedAt,value:point.followers.value}))}/>
                </> : <>
                  <div className="panel-header"><div><span className="eyebrow">AUDIENCE</span><h2>Follower growth</h2></div><div className="range-tabs">{["7D","28D","90D","1Y"].map((item) => <button className={range === item ? "selected" : ""} key={item} onClick={() => setRange(item)}>{item}</button>)}</div></div>
                  <div className="chart-summary"><strong>12,842</strong><span><TrendingUp size={13}/> +634 this period</span></div>
                  <DemoGrowthChart range={range}/>
                </>}
              </article>

              <article className="panel signals-panel">
                <div className="panel-header"><div><span className="eyebrow">DISCOVER</span><h2>Viral signals <DataBadge source={dataSource}/></h2></div><button className="text-btn" onClick={() => changeView("Discover")}>View all <ArrowUpRight size={13}/></button></div>
                <div className="signal-heading"><span>TOPIC</span><span>VELOCITY</span><span>SCORE</span></div>
                {filteredSignals.slice(0,5).map((signal) => <div className="signal-row" key={signal.topic}><div className="signal-name"><Flame size={15}/><div><strong>{signal.topic}</strong><span>{signal.change}</span></div></div>{dataSource==="demo"&&signal.bars?<div className="microbars">{signal.bars.map((bar,i) => <i key={i} style={{height: `${bar}px`}}/>)}</div>:<span><ProvenanceText provenance={signal.scoreProvenance}/></span>}<b>{signal.score}</b></div>)}
              </article>

              <article className="panel content-panel"><ContentTable items={visibleContent.slice(0,5)} filter={contentFilter} onFilter={setContentFilter} onCreate={() => openComposer()} onPublish={publishPost}/></article>
              <article className="panel opportunities-panel"><OpportunityList items={filteredOpportunities} source={dataSource} onView={() => changeView("Discover")} onReply={setSelectedReply}/></article>
            </section>
          </>}

          {view === "Discover" && (
            <DiscoverView signals={filteredSignals} opportunities={filteredOpportunities} source={dataSource} syncing={syncBusy} syncEnabled={Boolean(runtimeConfig.sync?.next.enabled)} error={syncError} lastSync={lastSync} onSync={()=>void syncFromX()} onConnect={() => openSettings("x")} onCredits={()=>openSettings("limits")} onReply={setSelectedReply} onCreate={(signal) => {void sendFeedback("idea",signal.topic,1,signal);openComposer({parts:[signal.hook],topic:signal.topic,generated:false})}} onFeedback={(signal,vote)=>void sendFeedback("idea",signal.topic,vote,signal)}/>
          )}
          {view === "Content" && <section className="panel full-panel"><ContentTable items={visibleContent} filter={contentFilter} onFilter={setContentFilter} onCreate={() => openComposer()} onPublish={publishPost}/></section>}
          {view === "Schedule" && <ScheduleView items={content.filter((item) => item.status === "Scheduled")} onCreate={() => openComposer()} postingTimes={dataSource==="live"?analytics?.postingTimes:undefined}/>}
          {view === "Analytics" && <AnalyticsView range={range} setRange={changeRange} data={dataSource==="live"?analytics:undefined}/>}
          </>}
        </div>
      </section>
      {composerSeed && <Composer
        seed={composerSeed}
        csrf={csrf}
        evergreenEnabled={runtimeConfig.evergreenEnabled}
        aiReady={aiReady}
        onClose={() => setComposerSeed(null)}
        onOpenSettings={()=>{setComposerSeed(null);changeView("Settings")}}
        onSave={savePost}
      />}
      {selectedReply && <ReplyComposer opportunity={selectedReply} live={dataSource === "live"} csrf={csrf} aiRepliesApproved={runtimeConfig.aiRepliesApproved} onFeedback={(vote)=>void sendFeedback("reply",selectedReply.id,vote,selectedReply)} onClose={() => setSelectedReply(undefined)}/>}
      {setupGuide && <SetupGuide onClose={dismissOnboarding} onGoToSettings={() => { setSetupGuide(false); openSettings("x"); }} onGoToCredits={()=>{setSetupGuide(false);openSettings("limits")}}/>}
    </main>
  );
}

function ContentTable({ items, filter, onFilter, onCreate, onPublish }: { items: ContentItem[]; filter: string; onFilter: (v: string) => void; onCreate: () => void; onPublish:(id:string|number)=>Promise<boolean> }) {
  return <div><div className="panel-header"><div><span className="eyebrow">PUBLISH</span><h2>Content queue</h2></div><button className="outline-btn" onClick={onCreate}><PenLine size={14}/> Create post</button></div><div className="content-tabs">{["All","Draft","Scheduled","Published","Failed","Needs review"].map((tab) => <button className={filter === tab ? "selected" : ""} key={tab} onClick={() => onFilter(tab)}>{tab}</button>)}</div><div className="content-table"><div className="content-row content-head"><span>CONTENT</span><span>STATUS</span><span>DATE</span><span>EVERGREEN</span><span>RESULT</span><span/></div>{items.map((item) => <div className="content-row" key={item.id}><strong title={item.lastError||item.text}>{item.text}</strong><span className={`status ${item.status.toLowerCase().replace(" ","-")}`}><i/>{item.status}</span><span>{item.date}</span><span>{item.evergreen?"Yes":"—"}</span><span>{item.lastError??item.impressions??"—"}</span>{["Draft","Failed"].includes(item.status)?<button className="row-action" onClick={()=>void onPublish(item.id)}>{item.status==="Failed"?"Retry":"Publish"}</button>:<button className="plain-icon"><MoreHorizontal size={16}/></button>}</div>)}</div>{items.length === 0 && <div className="empty-state">No posts in this view.</div>}</div>;
}

function DataBadge({source}:{source:ProvenanceSource}) { return <span className={`data-badge ${source}`}>{source === "live" ? <><i/> LIVE FROM X</> : source === "demo" ? "DEMO DATA" : source.toUpperCase()}</span>; }

function ProvenanceText({provenance}:{provenance:Provenance}) {
  return <>{provenance.source}{provenance.recordedAt>0?` · ${new Date(provenance.recordedAt).toLocaleString()}`:""}</>;
}

function OpportunityList({ items, onView, onReply, source }: { items: ReplyOpportunity[]; onView: () => void; onReply: (item:ReplyOpportunity) => void; source:"demo"|"live" }) {
  return <div><div className="panel-header"><div><span className="eyebrow">ENGAGE</span><h2>Best reply opportunities <DataBadge source={source}/></h2></div><button className="text-btn" onClick={onView}>View all <ArrowUpRight size={13}/></button></div><div className="opportunity-head"><span>AUTHOR & POST</span><span>EST. REACH</span><span>RELEVANCE</span></div>{items.slice(0,4).map((item) => <div className="opportunity-row" key={item.id}><div className="author"><div className="avatar">{item.initials}</div><div><strong>{item.name}<small>{item.handle}</small></strong><p>{item.post}</p><small>{item.reason}{item.algorithmVersion?` · ${item.algorithmVersion}`:""}</small></div></div><span>{item.reach}<small><ProvenanceText provenance={item.reachProvenance}/></small></span><b>{item.relevance}%<small><ProvenanceText provenance={item.relevanceProvenance}/></small></b><button className="outline-btn" onClick={() => onReply(item)}><MessageCircle size={14}/> Reply</button></div>)}</div>;
}

function DiscoverView({ signals: rows, opportunities: ops, onCreate, onReply, onSync, onConnect, onCredits, onFeedback, source, syncing, syncEnabled, error, lastSync }: { signals: IdeaSignal[]; opportunities: ReplyOpportunity[]; onCreate: (signal:IdeaSignal) => void; onReply:(item:ReplyOpportunity)=>void; onSync:()=>void; onConnect:()=>void; onCredits:()=>void; onFeedback:(signal:IdeaSignal,vote:number)=>void; source:"demo"|"live"; syncing:boolean; syncEnabled:boolean; error:string; lastSync?:string }) {
  const disabled=syncing||!syncEnabled;
  const guidance=error?syncErrorGuidance(error):null;
  return <div className="discover-layout"><section className="source-banner"><div><DataBadge source={source}/><p>{source === "live" ? `Ideas and replies are ranked from your real X feed${lastSync ? ` · synced ${new Date(lastSync).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : ""}.` : "These are examples. Connect X to derive ideas and reply opportunities from accounts you actually follow."}</p>{source==="live"&&!syncEnabled&&<small>OpenX&apos;s local safety cap cannot cover another complete sync. This is separate from X Credits. <button className="inline-link" onClick={onCredits}>Open Settings → Limits</button></small>}</div>{source === "live" ? <button className="outline-btn" onClick={onSync} disabled={disabled}><CircleGauge size={14}/>{syncing ? "Syncing…" : "Sync X data"}</button> : <button className="primary-btn" onClick={onConnect}><Link2 size={14}/> Connect X</button>}</section>{guidance && <div className="sync-error" role="alert"><span>{guidance.body}</span>{guidance.manageLimits&&<button className="text-btn" onClick={onCredits}>Open Settings → Limits</button>}</div>}<section className="panel full-panel"><div className="panel-header"><div><span className="eyebrow">IDEAS FROM YOUR NETWORK</span><h2>What is gaining momentum</h2><p>Topics found in your home timeline and compared with your recent posts.</p></div><button className="outline-btn" onClick={source === "live" ? onSync : onConnect} disabled={source==="live"&&disabled}><CircleGauge size={14}/> {source === "live" ? syncing?"Syncing…":"Sync X data" : "Connect for live ideas"}</button></div><div className="signal-cards">{rows.map((signal, index) => <article key={signal.topic}><div className="signal-rank">0{index+1}</div><Flame size={18}/><div><h3>{signal.topic} <small>{signal.pillar}</small></h3><p>{signal.rationale || signal.change}{signal.algorithmVersion?` · ${signal.algorithmVersion}`:""}</p></div><div className="idea-vote"><button onClick={()=>onFeedback(signal,1)}>👍</button><button onClick={()=>onFeedback(signal,-1)}>👎</button></div><div className="signal-score"><strong>{signal.score}</strong><span><ProvenanceText provenance={signal.scoreProvenance}/></span></div><button className="outline-btn" onClick={() => onCreate(signal)}><Lightbulb size={14}/> Use idea</button></article>)}</div></section><section className="panel full-panel"><OpportunityList items={ops} source={source} onReply={onReply} onView={() => {}}/></section></div>;
}

function ScheduleView({ items, onCreate,postingTimes }: { items: ContentItem[]; onCreate: () => void;postingTimes?:AnalyticsData["postingTimes"] }) {
  const start=new Date();start.setHours(0,0,0,0);const days=Array.from({length:7},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);return date});
  const recommendation=postingTimes?.status==="ready"&&postingTimes.suggestions.length?`Recommended from ${postingTimes.sampleSize} published posts: ${postingTimes.suggestions.slice(0,3).map((item)=>item.label).join(", ")}`:`Insufficient data for posting-time recommendations${postingTimes?` (${postingTimes.sampleSize}/${postingTimes.minimumSamples} published posts)`:""}.`;
  return <section className="panel full-panel calendar-panel"><div className="panel-header"><div><span className="eyebrow">PERSISTENT SCHEDULE</span><h2>Next seven days</h2><p>Scheduled posts are stored in D1 and published by the protected cron endpoint.</p><p><Clock3 size={12}/> {recommendation}</p></div><button className="primary-btn" onClick={onCreate}><Plus size={16}/> Schedule post</button></div><div className="calendar-grid">{days.map((day)=>{const dayItems=items.filter((item)=>item.date!=="—"&&new Date(item.date).toDateString()===day.toDateString());return <div className="calendar-day" key={day.toISOString()}><strong>{day.toLocaleDateString(undefined,{weekday:"short",day:"numeric"}).toUpperCase()}</strong>{dayItems.map((item)=><article key={item.id}><span>{new Date(item.date).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span><p>{item.text}</p>{item.evergreen&&<small>Evergreen</small>}</article>)}</div>})}</div></section>;
}

type UsageControlResult={ok:boolean;message:string};

function LimitsSettings({config,syncing,onSave,onReset}:{config:AppRuntimeConfig;syncing:boolean;onSave:(limits:{maxResources:number;maxSyncResources:number;maxWrites:number})=>Promise<UsageControlResult>;onReset:()=>Promise<UsageControlResult>}) {
  const usage=config.usage;
  const [daily,setDaily]=useState(String(usage?.maxResources??500));
  const [perSync,setPerSync]=useState(String(usage?.maxSyncResources??11));
  const [writes,setWrites]=useState(String(usage?.maxWrites??50));
  const [busy,setBusy]=useState<"save"|"reset"|null>(null);
  const [message,setMessage]=useState<UsageControlResult|null>(null);
  const controlsEnabled=Boolean(config.usageControlsEnabled&&usage)&&!syncing&&!busy;
  const validate=():{valid:true;limits:{maxResources:number;maxSyncResources:number;maxWrites:number}}|{valid:false;error:string}=>{
    const limits={maxResources:Number(daily),maxSyncResources:Number(perSync),maxWrites:Number(writes)};
    if(!Number.isInteger(limits.maxResources)||limits.maxResources<11||limits.maxResources>10_000)return {valid:false,error:"Daily returned data cap must be a whole number from 11 to 10,000."};
    if(!Number.isInteger(limits.maxSyncResources)||limits.maxSyncResources<11||limits.maxSyncResources>101)return {valid:false,error:"Per-sync cap must be a whole number from 11 to 101."};
    if(limits.maxSyncResources>limits.maxResources)return {valid:false,error:"Per-sync cap cannot be higher than the daily cap."};
    if(!Number.isInteger(limits.maxWrites)||limits.maxWrites<0||limits.maxWrites>1_000)return {valid:false,error:"Daily write-attempt cap must be a whole number from 0 to 1,000."};
    return {valid:true,limits};
  };
  const save=async()=>{const parsed=validate();if(!parsed.valid){setMessage({ok:false,message:parsed.error});return}setBusy("save");setMessage(null);setMessage(await onSave(parsed.limits));setBusy(null)};
  const reset=async()=>{setBusy("reset");setMessage(null);setMessage(await onReset());setBusy(null)};
  const resourcePercent=usage?.maxResources?Math.min(100,Math.round(100*usage.usedResources/usage.maxResources)):0;
  const writePercent=usage?.maxWrites?Math.min(100,Math.round(100*usage.usedWrites/usage.maxWrites)):0;
  return <div className="credits-layout settings-limits">
    <section className="settings-intro">
      <div><span className="eyebrow">LOCAL SAFETY LIMITS</span><h2>Choose how much OpenX can use</h2><p>These caps belong to this OpenX installation. They do not change your paid balance with X or your AI provider.</p></div>
      <div className="credits-reset-summary"><span>Next automatic reset</span><strong>{localResetLabel(usage?.resetsAt)}</strong><small>Daily OpenX counters use the UTC day.</small></div>
    </section>

    <section className="credits-usage-grid" aria-label="OpenX local usage">
      <article className="panel usage-card"><span>OPENX DATA ITEMS</span><strong>{usage?`${usage.usedResources} / ${usage.maxResources}`:"—"}</strong><p>Returned X data items counted today. {usage?`${usage.availableResources} remain.`:"Unavailable in demo mode."}</p><div className="usage-track" role="progressbar" aria-label="Returned X data items used" aria-valuemin={0} aria-valuemax={usage?.maxResources??0} aria-valuenow={usage?.usedResources??0}><i style={{width:`${resourcePercent}%`}}/></div></article>
      <article className="panel usage-card"><span>PER-SYNC DATA CAP</span><strong>{usage?.maxSyncResources??"—"}</strong><p>A single sync can count at most this many returned items. Unused daily capacity remains available for later syncs.</p></article>
      <article className="panel usage-card"><span>OPENX WRITE ATTEMPTS</span><strong>{usage?`${usage.usedWrites} / ${usage.maxWrites}`:"—"}</strong><p>Local attempts counted today. This is a safety gate, not a provider invoice.</p><div className="usage-track" role="progressbar" aria-label="Write attempts used" aria-valuemin={0} aria-valuemax={usage?.maxWrites??0} aria-valuenow={usage?.usedWrites??0}><i style={{width:`${writePercent}%`}}/></div></article>
    </section>

    <div className="credits-main-grid">
      <section className="settings-subcard limits-editor" aria-labelledby="limits-editor-heading">
        <span className="eyebrow">USER-DEFINED SAFETY CAPS</span><h2 id="limits-editor-heading">Choose how much OpenX may count</h2><p>These values control OpenX preflight checks. A sync is stopped before contacting X when the remaining local allowance cannot cover it.</p>
        <div className="limits-form">
          <label>Daily returned data items<input type="number" min="11" max="10000" step="1" value={daily} onChange={(event)=>setDaily(event.target.value)} disabled={!controlsEnabled}/><small>11–10,000. Resets automatically each UTC day.</small></label>
          <label>Returned data items per sync<input type="number" min="11" max="101" step="1" value={perSync} onChange={(event)=>setPerSync(event.target.value)} disabled={!controlsEnabled}/><small>11–101, never higher than the daily cap.</small></label>
          <label>Daily write attempts<input type="number" min="0" max="1000" step="1" value={writes} onChange={(event)=>setWrites(event.target.value)} disabled={!controlsEnabled}/><small>Set 0 to block all X writes locally.</small></label>
        </div>
        <div className="limits-actions"><button className="primary-btn" onClick={()=>void save()} disabled={!controlsEnabled}>{busy==="save"?"Saving…":"Save limits"}</button><span>Deployment defaults: {usage?.deploymentMaxResources??"—"} data items · {usage?.deploymentMaxWrites??"—"} writes. {usage?.userConfigured?"Your override is active.":"No user override yet."}</span></div>
      </section>

      <section className="settings-subcard reset-panel" aria-labelledby="reset-limits-heading">
        <RotateCcw size={20}/><span className="eyebrow">TESTING AND RECOVERY</span><h2 id="reset-limits-heading">Reset today&apos;s OpenX counters</h2><p>This clears today&apos;s returned-data and write-attempt counters only. It does not change your saved caps, cached content, X authorization, X Developer Credits, or AI credits.</p><button className="outline-btn" onClick={()=>void reset()} disabled={!controlsEnabled}>{busy==="reset"?"Resetting…":"Reset today's counters"}</button>
        {syncing&&<small>A sync is running. Controls unlock when it finishes.</small>}
      </section>
    </div>

    {message&&<div className={`usage-control-message ${message.ok?"success":"error"}`} role={message.ok?"status":"alert"}>{message.message}</div>}

  </div>;
}

function AnalyticsView({ range, setRange, data }: { range: string; setRange: (v: string) => void; data?:AnalyticsData }) {
  if(!data||data.dataStatus==="insufficient_data")return <section className="panel full-panel empty-analytics"><BarChart3 size={28}/><h2>Insufficient analytics data</h2><p>Sync X to store real post and follower snapshots. Charts and recommendations appear only when their documented sample thresholds are met.</p></section>;
  const cards=[{label:"Impressions",metric:data.derived.totals.impressions,icon:CircleGauge},{label:"Engagement rate",metric:{...data.derived.totals.engagementRate,value:data.derived.totals.engagementRate.value*100},suffix:"%",icon:Activity},{label:"Replies",metric:data.derived.totals.replies,icon:MessageCircle},{label:"Reposts",metric:data.derived.totals.reposts,icon:TrendingUp}];
  const breakdown=(title:string,rows:AnalyticsBreakdown[])=>{const maximum=Math.max(0,...rows.map((row)=>row.medianEngagementRate.value));return <section className="panel analytics-breakdown"><div className="panel-header"><div><span className="eyebrow">DERIVED FROM X SNAPSHOTS</span><h2>{title}</h2></div></div>{rows.length?rows.slice(0,6).map((row)=><div className="breakdown-row" key={row.label}><span>{row.label}</span><i><b style={{width:`${maximum?Math.max(8,100*(row.medianEngagementRate.value/maximum)):0}%`}}/></i><strong>{(row.medianEngagementRate.value*100).toFixed(2)}%<small><ProvenanceText provenance={row.provenance}/></small></strong></div>):<div className="empty-state">Insufficient data</div>}</section>};
  return <div className="analytics-layout"><section className="metrics-row">{cards.map(({label,metric,suffix="",icon:Icon})=><article className="metric-card" key={label}><div><span>{label}</span><strong>{metric.value.toLocaleString(undefined,{maximumFractionDigits:2})}{suffix}</strong><small><Check size={12}/><ProvenanceText provenance={metric.provenance}/></small></div><div className="metric-icon"><Icon size={18}/></div></article>)}</section><section className="panel full-panel"><div className="panel-header"><div><span className="eyebrow">DERIVED SERIES</span><h2>Impressions over time</h2><p><ProvenanceText provenance={data.derived.totals.impressions.provenance}/></p></div><div className="range-tabs">{["7D","28D","90D","1Y"].map((item)=><button className={range===item?"selected":""} key={item} onClick={()=>setRange(item)}>{item}</button>)}</div></div><div className="large-chart"><DataSeriesChart label="Impressions from X snapshots" points={data.derived.series.map((point)=>({recordedAt:point.recordedAt,value:point.impressions.value}))}/></div></section><div className="analytics-grid">{breakdown("Performance by topic",data.derived.byTopic)}{breakdown("Performance by format",data.derived.byFormat)}{breakdown("Best hooks",data.derived.byHook)}{breakdown("Posting-hour performance",data.derived.byHour)}</div></div>;
}

type SettingsPageProps={
  selected:SettingsSection;
  onSelect:(section:SettingsSection)=>void;
  connected:boolean;
  config:AppRuntimeConfig;
  csrf:string;
  syncing:boolean;
  onSaveLimits:(limits:{maxResources:number;maxSyncResources:number;maxWrites:number})=>Promise<UsageControlResult>;
  onResetLimits:()=>Promise<UsageControlResult>;
  onRuntimeRefresh:()=>void;
  onDisconnected:()=>void;
  onOpenGuide:()=>void;
};

function SettingsToggle({checked,onChange,title,description}:{checked:boolean;onChange:(checked:boolean)=>void;title:string;description:string}) {
  return <label className="settings-toggle"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event)=>onChange(event.target.checked)}/><i aria-hidden="true"/></label>;
}

function SettingsFeedback({message,error}:{message:string;error:boolean}) {
  if(!message)return null;
  return <div className={`settings-feedback ${error?"error":"success"}`} role={error?"alert":"status"}>{error?<CircleGauge size={15}/>:<Check size={15}/>}<span>{message}</span></div>;
}

function SettingsPage({selected,onSelect,connected,config,csrf,syncing,onSaveLimits,onResetLimits,onRuntimeRefresh,onDisconnected,onOpenGuide}:SettingsPageProps) {
  const [settings,setSettings]=useState<RuntimeSettingsData>();
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<SettingsSection|null>(null);
  const [feedback,setFeedback]=useState<{section:SettingsSection;message:string;error:boolean}|null>(null);
  const [origin]=useState(()=>typeof window==="undefined"?"https://your-domain.com":window.location.origin);
  const [clientId,setClientId]=useState("");
  const [clientSecret,setClientSecret]=useState("");
  const [clearClientSecret,setClearClientSecret]=useState(false);
  const [aiProvider,setAiProvider]=useState<RuntimeSettingsData["ai"]["provider"]>("OpenRouter");
  const [aiBaseUrl,setAiBaseUrl]=useState("https://openrouter.ai/api/v1");
  const [aiModel,setAiModel]=useState("");
  const [aiApiKey,setAiApiKey]=useState("");
  const [clearAiApiKey,setClearAiApiKey]=useState(false);
  const [contentApproved,setContentApproved]=useState(false);
  const [repliesApproved,setRepliesApproved]=useState(false);
  const [evergreen,setEvergreen]=useState(false);
  const [syncTtl,setSyncTtl]=useState("900");
  const [cronSecret,setCronSecret]=useState("");
  const [clearCronSecret,setClearCronSecret]=useState(false);
  const [apiToken,setApiToken]=useState("");
  const [clearApiToken,setClearApiToken]=useState(false);
  const [appAccessToken,setAppAccessToken]=useState("");
  const [dataMessage,setDataMessage]=useState("");

  const applySettings=(next:RuntimeSettingsData)=>{
    setSettings(next);
    setClientId(next.x.clientId);
    setAiProvider(next.ai.provider);
    setAiBaseUrl(next.ai.baseUrl);
    setAiModel(next.ai.model);
    setContentApproved(next.ai.contentApproved);
    setRepliesApproved(next.ai.repliesApproved);
    setEvergreen(next.publishing.evergreenEnabled);
    setSyncTtl(String(next.publishing.syncTtlSeconds));
  };

  useEffect(()=>{
    let active=true;
    void (async()=>{
      try{
        const response=await fetch("/api/settings",{cache:"no-store"});
        if(!response.ok)throw new Error("SETTINGS_UNAVAILABLE");
        const payload=await response.json() as RuntimeSettingsData;
        if(active)applySettings(payload);
      }catch{if(active)setFeedback({section:"security",message:"Settings could not be loaded. Complete the guided setup, then reload this page.",error:true})}
      finally{if(active)setLoading(false)}
    })();
    return()=>{active=false};
  },[]);

  const save=async(section:SettingsSection,body:Record<string,unknown>,successMessage:string)=>{
    if(!csrf){setFeedback({section,message:"Settings are not ready yet. Reload the page and try again.",error:true});return false}
    setBusy(section);setFeedback(null);
    try{
      const response=await fetch("/api/settings",{method:"PATCH",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(body)});
      const payload=await response.json().catch(()=>({})) as {error?:string;settings?:RuntimeSettingsData;xAuthorizationCleared?:boolean};
      if(!response.ok||!payload.settings)throw new Error(payload.error??"SETTINGS_SAVE_FAILED");
      applySettings(payload.settings);
      setClientSecret("");setAiApiKey("");setCronSecret("");setApiToken("");setAppAccessToken("");
      setClearClientSecret(false);setClearAiApiKey(false);setClearCronSecret(false);setClearApiToken(false);
      if(payload.xAuthorizationCleared)onDisconnected();
      onRuntimeRefresh();
      setFeedback({section,message:successMessage,error:false});
      return true;
    }catch(error){
      const code=error instanceof Error?error.message:"SETTINGS_SAVE_FAILED";
      const message=code==="INVALID_SETTINGS_INPUT"?"Check the highlighted values and try again.":"OpenX could not save these settings.";
      setFeedback({section,message,error:true});
      return false;
    }finally{setBusy(null)}
  };

  const submitX=(event:FormEvent)=>{event.preventDefault();void save("x",{section:"x",clientId:clientId.trim(),...(clientSecret?{clientSecret}:{}),clearClientSecret},"X application settings saved. Reconnect X if you changed the credentials.")};
  const submitAi=(event:FormEvent)=>{event.preventDefault();void save("ai",{section:"ai",baseUrl:aiBaseUrl.trim(),model:aiModel.trim(),...(aiApiKey?{apiKey:aiApiKey}:{}),clearApiKey:clearAiApiKey,contentApproved,repliesApproved},"AI settings saved. The API key is encrypted and will not be shown again.")};
  const submitPublishing=(event:FormEvent)=>{event.preventDefault();const ttl=Number(syncTtl);if(!Number.isInteger(ttl)||ttl<60||ttl>86_400){setFeedback({section:"publishing",message:"Sync cache must be a whole number from 60 to 86,400 seconds.",error:true});return}void save("publishing",{section:"publishing",evergreenEnabled:evergreen,syncTtlSeconds:ttl,...(cronSecret?{cronSecret}:{}),clearCronSecret,...(apiToken?{apiToken}:{}),clearApiToken},"Publishing settings saved.")};
  const submitAccess=(event:FormEvent)=>{event.preventDefault();if(appAccessToken.length<16){setFeedback({section:"security",message:"Use an access token with at least 16 characters.",error:true});return}void save("security",{section:"access",appAccessToken},"Application access token replaced. Use the new token the next time you sign in.")};
  const chooseAiProvider=(provider:RuntimeSettingsData["ai"]["provider"])=>{setAiProvider(provider);if(provider==="OpenRouter")setAiBaseUrl("https://openrouter.ai/api/v1");if(provider==="OpenAI")setAiBaseUrl("https://api.openai.com/v1")};

  const disconnect=async()=>{if(!window.confirm("Disconnect X and delete its saved authorization? Drafts and analytics remain."))return;const response=await fetch("/api/x/disconnect",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({intent:"disconnect"})});if(response.ok){onDisconnected();setDataMessage("X was disconnected. Drafts, schedules and analytics remain.")}else setDataMessage("OpenX could not disconnect X.")};
  const deleteAll=async()=>{if(!window.confirm("Delete every local draft, schedule, metric, cached X post, OAuth token and setting saved in this app? This cannot be undone."))return;const response=await fetch("/api/data/delete",{method:"DELETE",headers:{"X-CSRF-Token":csrf}});if(response.ok){onDisconnected();setDataMessage("All local application data was deleted. Refreshing…");setTimeout(()=>window.location.reload(),700)}else setDataMessage("Deletion failed.")};
  const importData=async(file:File)=>{try{const payload=JSON.parse(await file.text());const response=await fetch("/api/data/import",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(payload)});const failure=response.ok?undefined:await response.json() as {error?:string};setDataMessage(response.ok?"Import completed. Refresh to see the data.":`Import failed: ${failure?.error??"unknown error"}`)}catch{setDataMessage("Invalid JSON export.")}};

  const sections:Array<{id:SettingsSection;label:string;description:string;icon:typeof Settings;status?:string}>=[
    {id:"x",label:"X account",description:"OAuth app and connection",icon:Link2,status:connected?"Connected":settings?.x.clientId?"Ready":"Setup needed"},
    {id:"ai",label:"AI provider",description:"OpenRouter, OpenAI or custom",icon:Sparkles,status:settings?.ai.apiKeyConfigured?"Configured":"Optional"},
    {id:"publishing",label:"Publishing",description:"Evergreen and integrations",icon:Send},
    {id:"limits",label:"Limits",description:"Local safety caps",icon:CreditCard},
    {id:"security",label:"Security",description:"Application access",icon:Settings},
    {id:"data",label:"Data & privacy",description:"Export, import and delete",icon:FileText},
  ];
  const sectionFeedback=feedback?.section===selected?feedback:null;

  return <div className="settings-page">
    <aside className="panel settings-nav" aria-label="Settings sections">
      <header><span className="eyebrow">SETTINGS</span><h2>Manage OpenX</h2><p>Change the application directly. Secrets are never shown after saving.</p></header>
      <nav>{sections.map(({id,label,description,icon:Icon,status})=><button key={id} className={selected===id?"active":""} onClick={()=>onSelect(id)}><Icon size={17}/><span><strong>{label}</strong><small>{description}</small></span>{status&&<em>{status}</em>}</button>)}</nav>
    </aside>

    <section className="panel settings-content" aria-live="polite">
      {loading?<div className="settings-loading"><CircleGauge size={24}/><p>Loading settings…</p></div>:<>
        {selected==="x"&&<form className="settings-form" onSubmit={submitX}>
          <div className="settings-intro"><div><span className="eyebrow">X ACCOUNT</span><h2>Connect your X application</h2><p>Paste the OAuth credentials from the X Developer Console. You never paste an X access token here.</p></div><span className={`settings-state ${connected?"ok":""}`}><i/>{connected?"Connected":"Not connected"}</span></div>
          <div className="settings-field-grid"><label className="settings-field"><span>OAuth 2.0 Client ID <b>Required</b></span><input value={clientId} onChange={(event)=>setClientId(event.target.value)} autoComplete="off" placeholder="Paste the Client ID" required minLength={3}/><small>Found under your X app OAuth 2.0 settings.</small></label><label className="settings-field"><span>Client secret <b>Only if X provides one</b></span><input type="password" value={clientSecret} onChange={(event)=>setClientSecret(event.target.value)} autoComplete="new-password" placeholder={settings?.x.clientSecretConfigured?"Saved securely — leave blank to keep":"Optional for public PKCE apps"}/><small>The existing value is never returned to the browser.</small></label></div>
          {settings?.x.clientSecretConfigured&&<label className="settings-clear"><input type="checkbox" checked={clearClientSecret} onChange={(event)=>setClearClientSecret(event.target.checked)}/> Remove the saved client secret when I save</label>}
          <div className="settings-callbacks"><CopyField label="Website URL" value={origin}/><CopyField label="Callback / Redirect URI" value={`${origin}/api/x/oauth/callback`}/></div>
          <div className="settings-note"><CircleGauge size={16}/><p><strong>Changing these credentials disconnects X.</strong><span>You will authorize the account again with the new application.</span></p></div>
          <div className="settings-save-row"><button className="primary-btn" disabled={busy==="x"||!clientId.trim()}>{busy==="x"?"Saving…":"Save X settings"}</button><a className="outline-btn" href={X_DEV_CONSOLE} target="_blank" rel="noreferrer">Open X Developer Console <ArrowUpRight size={14}/></a>{!connected&&config.configured&&<a className="outline-btn" href="/api/x/oauth/start"><Link2 size={14}/> Continue with X</a>}{connected&&<button type="button" className="danger-btn" onClick={()=>void disconnect()}>Disconnect X</button>}</div>
          <SettingsFeedback message={sectionFeedback?.message??""} error={sectionFeedback?.error??false}/>
        </form>}

        {selected==="ai"&&<form className="settings-form" onSubmit={submitAi}>
          <div className="settings-intro"><div><span className="eyebrow">AI PROVIDER</span><h2>Add OpenRouter without Cloudflare</h2><p>Choose a provider, paste its API key here, select a model and save. OpenX stores the key encrypted in its database.</p></div><span className={`settings-state ${settings?.ai.apiKeyConfigured?"ok":""}`}><i/>{settings?.ai.apiKeyConfigured?"Configured":"Optional"}</span></div>
          <div className="settings-field-grid"><label className="settings-field"><span>Provider</span><select value={aiProvider} onChange={(event)=>chooseAiProvider(event.target.value as RuntimeSettingsData["ai"]["provider"])}><option>OpenRouter</option><option>OpenAI</option><option>Custom OpenAI-compatible</option></select><small>The endpoint is filled automatically for OpenRouter and OpenAI.</small></label><label className="settings-field"><span>Model</span><input value={aiModel} onChange={(event)=>setAiModel(event.target.value)} placeholder={aiProvider==="OpenRouter"?"Example: openai/gpt-5-mini":"Model ID"} required/><small>Use the exact model ID supported by your provider.</small></label></div>
          {aiProvider==="Custom OpenAI-compatible"&&<label className="settings-field"><span>Provider base URL</span><input type="url" value={aiBaseUrl} onChange={(event)=>setAiBaseUrl(event.target.value)} placeholder="https://provider.example/v1" required/><small>HTTPS only. Do not include credentials, query parameters or fragments.</small></label>}
          <label className="settings-field"><span>API key</span><input type="password" value={aiApiKey} onChange={(event)=>setAiApiKey(event.target.value)} autoComplete="new-password" placeholder={settings?.ai.apiKeyConfigured?"Saved securely — leave blank to keep":"Paste the provider API key"}/><small>The key is write-only: after saving, OpenX only shows whether one exists.</small></label>
          {settings?.ai.apiKeyConfigured&&<label className="settings-clear"><input type="checkbox" checked={clearAiApiKey} onChange={(event)=>setClearAiApiKey(event.target.checked)}/> Remove the saved AI key when I save</label>}
          <div className="settings-toggle-list"><SettingsToggle checked={contentApproved} onChange={setContentApproved} title="AI-assisted content drafts" description="Allow generation only when you explicitly request a draft."/><SettingsToggle checked={repliesApproved} onChange={setRepliesApproved} title="AI-assisted reply drafts" description="Allow reply suggestions for human review. Nothing is posted automatically."/></div>
          <div className="settings-save-row"><button className="primary-btn" disabled={busy==="ai"||!aiModel.trim()||!aiBaseUrl.trim()}>{busy==="ai"?"Saving…":"Save AI settings"}</button>{aiProvider==="OpenRouter"&&<a className="outline-btn" href={OPENROUTER_KEYS} target="_blank" rel="noreferrer">Get an OpenRouter key <ArrowUpRight size={14}/></a>}</div>
          <SettingsFeedback message={sectionFeedback?.message??""} error={sectionFeedback?.error??false}/>
        </form>}

        {selected==="publishing"&&<form className="settings-form" onSubmit={submitPublishing}>
          <div className="settings-intro"><div><span className="eyebrow">PUBLISHING</span><h2>Publishing and integrations</h2><p>Keep normal publishing human-approved. The advanced keys are only needed for cron, API or MCP integrations.</p></div></div>
          <div className="settings-toggle-list"><SettingsToggle checked={evergreen} onChange={setEvergreen} title="Evergreen repost scheduling" description="Allow an explicitly marked post to be scheduled again. Disabled by default."/></div>
          <label className="settings-field settings-field-narrow"><span>Sync cache duration</span><div className="settings-unit-input"><input type="number" min="60" max="86400" step="1" value={syncTtl} onChange={(event)=>setSyncTtl(event.target.value)}/><b>seconds</b></div><small>How long a successful X sync is treated as fresh. Default: 900 seconds.</small></label>
          <details className="settings-advanced"><summary>Advanced integration keys <span>Optional</span></summary><div className="settings-field-grid"><div className="settings-field"><label htmlFor="settings-cron-secret"><span>Scheduled publishing secret</span></label><input id="settings-cron-secret" type="password" value={cronSecret} onChange={(event)=>setCronSecret(event.target.value)} autoComplete="new-password" placeholder={settings?.publishing.cronSecretConfigured?"Saved securely — leave blank to keep":"Optional CRON_SECRET"}/><small>Protects the scheduled publishing endpoint.</small>{settings?.publishing.cronSecretConfigured&&<label className="settings-clear"><input type="checkbox" checked={clearCronSecret} onChange={(event)=>setClearCronSecret(event.target.checked)}/> Remove saved secret</label>}</div><div className="settings-field"><label htmlFor="settings-api-token"><span>API and MCP token</span></label><input id="settings-api-token" type="password" value={apiToken} onChange={(event)=>setApiToken(event.target.value)} autoComplete="new-password" placeholder={settings?.publishing.apiTokenConfigured?"Saved securely — leave blank to keep":"Optional OPENX_API_TOKEN"}/><small>Bearer token for API and MCP access.</small>{settings?.publishing.apiTokenConfigured&&<label className="settings-clear"><input type="checkbox" checked={clearApiToken} onChange={(event)=>setClearApiToken(event.target.checked)}/> Remove saved token</label>}</div></div></details>
          <div className="settings-save-row"><button className="primary-btn" disabled={busy==="publishing"}>{busy==="publishing"?"Saving…":"Save publishing settings"}</button></div>
          <SettingsFeedback message={sectionFeedback?.message??""} error={sectionFeedback?.error??false}/>
        </form>}

        {selected==="limits"&&<><LimitsSettings key={`${config.usage?.maxResources??0}:${config.usage?.maxSyncResources??0}:${config.usage?.maxWrites??0}`} config={config} syncing={syncing} onSave={onSaveLimits} onReset={onResetLimits}/></>}

        {selected==="security"&&<div className="settings-form">
          <div className="settings-intro"><div><span className="eyebrow">SECURITY</span><h2>Protect this OpenX installation</h2><p>Replace the password-like access token used to open the app. Saved service keys remain encrypted with the installation secret.</p></div><span className={`settings-state ${settings?.access.appAccessTokenConfigured?"ok":""}`}><i/>{settings?.access.appAccessTokenConfigured?"Protected":"Action required"}</span></div>
          <form className="settings-subcard" onSubmit={submitAccess}><label className="settings-field"><span>Application access token</span><input type="password" value={appAccessToken} onChange={(event)=>setAppAccessToken(event.target.value)} autoComplete="new-password" placeholder="Enter a new token with at least 16 characters" required minLength={16}/><small>This replaces the token used on the OpenX sign-in screen. The existing token is never displayed.</small></label><div className="settings-save-row"><button className="primary-btn" disabled={busy==="security"||appAccessToken.length<16}>{busy==="security"?"Saving…":"Replace access token"}</button></div></form>
          <div className="settings-bootstrap"><div><Check size={16}/><span><strong>Encryption key</strong><small>{settings?.access.sessionSecretConfigured?"Configured during installation":"Missing — run guided setup"}</small></span></div><div><Check size={16}/><span><strong>Public application address</strong><small>{config.origin?.currentMatchesCanonical?"This address matches the deployment configuration":"Review the deployment address before connecting X"}</small></span></div></div>
          <CopyField label="Current application address" value={origin}/>
          <div className="settings-note"><Settings size={16}/><p><strong>Why two values stay in installation setup</strong><span>The encryption key must exist before OpenX can safely store the other keys. The public address is owned by the deployment and OAuth callback. Everything used day to day is editable above.</span></p></div>
          <button type="button" className="setup-help" onClick={onOpenGuide}><Lightbulb size={16}/><span><strong>Installation or recovery help</strong><small>Open the guided setup</small></span><ArrowUpRight size={15}/></button>
          <SettingsFeedback message={sectionFeedback?.message??""} error={sectionFeedback?.error??false}/>
        </div>}

        {selected==="data"&&<div className="settings-form">
          <div className="settings-intro"><div><span className="eyebrow">DATA &amp; PRIVACY</span><h2>Your local OpenX data</h2><p>Export a backup, restore one, disconnect X, or permanently delete data stored by this installation.</p></div></div>
          <div className="data-action-list"><div><span><strong>Export a backup</strong><small>Download drafts, schedules, analytics and feedback. Credentials and operational settings are excluded.</small></span><a className="outline-btn" href="/api/data/export" download>Export JSON</a></div><div><span><strong>Import a backup</strong><small>Restore a valid OpenX JSON export. Remote publishing identities are never restored.</small></span><label className="outline-btn file-button">Choose JSON<input type="file" accept="application/json" onChange={(event)=>{const file=event.target.files?.[0];if(file)void importData(file)}}/></label></div><div><span><strong>Disconnect X</strong><small>Delete X authorization and temporary ideas/replies cache. Durable local content remains.</small></span><button className="danger-btn" onClick={()=>void disconnect()}>Disconnect X</button></div><div className="danger-zone"><span><strong>Delete all local data</strong><small>Permanently removes content, analytics, cached X data, OAuth tokens and settings saved in this app.</small></span><button className="danger-btn" onClick={()=>void deleteAll()}>Delete all data</button></div></div>
          {dataMessage&&<div className="settings-feedback" role="status"><Check size={15}/><span>{dataMessage}</span></div>}
          <a className="text-btn" href="/privacy">Read the privacy notice <ArrowUpRight size={13}/></a>
        </div>}
      </>}
    </section>
  </div>;
}
