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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildChartCoordinates } from "../lib/chart";
import { buildGrowthPlan } from "../lib/growth-plan";
import { aiErrorGuidance, decideOnboarding, isWorkspaceBlocking, ONBOARDING_STORAGE_KEY, resolveWorkspaceState, sanitizeSyncError, syncErrorGuidance, type WorkspaceState } from "../lib/ui-state";
import type { IdeaSignal, ReplyOpportunity } from "../lib/x-growth";

type View = "Overview" | "Discover" | "Content" | "Schedule" | "Analytics" | "Settings";
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

type SavePostInput = {text:string;thread:string[];scheduledAt?:number;evergreen:boolean;evergreenIntervalDays:number;generated:boolean;topic?:string;hook?:string};
type XConfigurationSummary={xClientIdConfigured:boolean;xClientSecretConfigured:boolean;sessionSecretConfigured:boolean;appUrlConfigured:boolean;appAccessTokenConfigured:boolean;cronSecretConfigured:boolean;apiTokenConfigured:boolean};
type AiConfigurationSummary={provider:"OpenRouter"|"OpenAI"|"Custom OpenAI-compatible";model:string;apiKeyConfigured:boolean;contentApproved:boolean;repliesApproved:boolean};
type AppRuntimeConfig={configured:boolean;demoMode:boolean;accessProtected:boolean;aiConfigured:boolean;aiContentApproved:boolean;aiRepliesApproved:boolean;evergreenEnabled:boolean;syncTtlSeconds:number;xConfiguration?:XConfigurationSummary;aiConfiguration?:AiConfigurationSummary};
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
  usage:{requests:number;resources:number;reservedResources:number;writes:number;maxResources:number;maxWrites:number;remainingResources:number;remainingWrites:number;warning:boolean;reads:number;maxReads:number;provenance:Provenance};
};
type AccountProfile={id:string;name:string;username:string;profileImageUrl?:string;followersCount?:number};
type StoredPost={id:string;text:string;status:string;scheduledAt?:number;publishedAt?:number;evergreen?:boolean;lastError?:string};
type PostsPayload={posts:StoredPost[]};
type SyncPayload={account:AccountProfile;opportunities:ReplyOpportunity[];ideas:IdeaSignal[];syncedAt:string;error?:string};
type AiPayload={content?:string|string[];rationale?:string;generated?:boolean;error?:string};
type AiRequest={kind:"idea"|"post"|"thread"|"reply"|"rewrite";prompt:string;context?:string};
type ComposerSeed={parts:string[];topic?:string;generated:boolean};

const postStatusLabel=(status:string):PostStatus=>status==="needs_review"?"Needs review":`${status.charAt(0).toUpperCase()}${status.slice(1)}` as PostStatus;

async function fetchAnalyticsData(range="28D"):Promise<AnalyticsData | undefined>{const response=await fetch(`/api/analytics?range=${encodeURIComponent(range)}`);return response.ok?await response.json() as AnalyticsData:undefined}

async function fetchXSync(force=false):Promise<SyncPayload>{
  const response=await fetch(`/api/x/sync${force?"?force=1":""}`);
  const payload=await response.json() as SyncPayload;
  if(!response.ok)throw new Error(sanitizeSyncError(payload.error));
  return payload;
}

async function requestAiGeneration(csrf:string,input:AiRequest):Promise<AiPayload&{content:string|string[]}> {
  const response=await fetch("/api/ai/generate",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(input)});
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

function Composer({ onClose, onSave, onOpenSettings, seed, csrf, evergreenEnabled }: { onClose: () => void; onSave: (post:SavePostInput) => Promise<boolean>; onOpenSettings:()=>void;seed:ComposerSeed; csrf:string;evergreenEnabled:boolean }) {
  const [parts,setParts] = useState(seed.parts); const [scheduled,setScheduled]=useState(false); const [scheduledAt,setScheduledAt]=useState(""); const [evergreen,setEvergreen]=useState(false); const [interval,setInterval]=useState(30); const [generated,setGenerated]=useState(seed.generated); const [busy,setBusy]=useState(false); const [done,setDone]=useState(false); const [error,setError]=useState("");const [aiError,setAiError]=useState("");
  const updatePart=(index:number,value:string)=>setParts((current)=>current.map((part,position)=>position===index?value:part));
  const improve=async(kind:string)=>{setBusy(true);setError("");setAiError("");try{const payload=await requestAiGeneration(csrf,{kind:parts.length>1?"thread":"rewrite",prompt:`${kind}: ${parts.join("\n---\n")}`});const content=payload.content;setParts(Array.isArray(content)?content:[content]);setGenerated(true)}catch(failure){setAiError(failure instanceof Error?failure.message:"")}finally{setBusy(false)}};
  const submit=async()=>{const clean=parts.map((part)=>part.trim()).filter(Boolean);if(!clean.length||clean.some((part)=>part.length>280))return;setBusy(true);setError("");const ok=await onSave({text:clean[0],thread:clean,scheduledAt:scheduled&&scheduledAt?new Date(scheduledAt).getTime():undefined,evergreen,evergreenIntervalDays:interval,generated,topic:seed.topic,hook:clean[0].split("\n")[0]});setBusy(false);if(ok){setDone(true);setTimeout(onClose,650)}else setError("Could not save this post.")};
  const guidance=aiError?aiErrorGuidance(aiError):null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="composer" onMouseDown={(e) => e.stopPropagation()} aria-modal="true" role="dialog">
        <header><div><span className="eyebrow">COMPOSE</span><h2>Create a post</h2></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></header>
        <div className="composer-profile"><div className="avatar lime-avatar">YOU</div><div><strong>Your account</strong><span>@connected_account</span></div></div>
        <div className="thread-editor">{parts.map((part,index)=><div className="thread-part" key={index}><span>{index+1}</span><textarea value={part} onChange={(event)=>updatePart(index,event.target.value)} autoFocus={index===0} maxLength={280} placeholder={index===0?"Write your post…":"Continue the thread…"}/><small>{part.length}/280</small>{parts.length>1&&<button onClick={()=>setParts((current)=>current.filter((_,position)=>position!==index))} aria-label={`Remove part ${index+1}`}><X size={13}/></button>}</div>)}</div>
        <div className="composer-toolbar"><button className="outline-btn" onClick={()=>setParts((current)=>[...current,""])}><Plus size={14}/> Add thread post</button><div className="ai-tools"><button disabled={busy} onClick={()=>improve("Write a stronger hook")}><Sparkles size={14}/> Stronger hook</button><button disabled={busy} onClick={()=>improve("Shorten and clarify")}><Zap size={14}/> Shorten</button><button disabled={busy} onClick={()=>improve("Match my writing voice")}><PenLine size={14}/> Match my voice</button></div></div>
        <div className="publish-options"><label><input type="checkbox" checked={scheduled} onChange={(event)=>setScheduled(event.target.checked)}/> Schedule</label>{scheduled&&<input type="datetime-local" value={scheduledAt} onChange={(event)=>setScheduledAt(event.target.value)} min={new Date().toISOString().slice(0,16)}/>} {evergreenEnabled&&<><label><input type="checkbox" checked={evergreen} onChange={(event)=>setEvergreen(event.target.checked)}/> Evergreen</label>{evergreen&&<label>Repeat every <input type="number" min="7" value={interval} onChange={(event)=>setInterval(Number(event.target.value))}/> days</label>}</>}</div>
        {generated&&<div className="generated-notice"><Sparkles size={13}/> AI-generated suggestion — review every part before publishing.</div>}{guidance&&<div className="inline-error">{guidance.message}{guidance.openSettings&&<button className="text-btn" onClick={onOpenSettings}>Open Settings</button>}</div>}{error&&<div className="inline-error">{error}</div>}
        <footer><button className="ghost-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={submit} disabled={busy||!parts.some((part)=>part.trim())}>{done?<><Check size={16}/> Saved</>:busy?"Working…":scheduled?<><CalendarDays size={16}/> Schedule</>:<><FileText size={16}/> Save draft</>}</button></footer>
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
const X_OAUTH_DOCS = "https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code";

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

function EnvVarRow({ name, required, description, example }: { name: string; required?: boolean; description: string; example?: string }) {
  return (
    <div className="env-var-row">
      <div className="env-var-head">
        <code>{name}</code>
        <b className="schema">Schema: {required ? "required" : "optional"}</b>
      </div>
      <p>{description}</p>
      {example && <div className="copy-code example-code"><small>EXAMPLE</small><code>{example}</code></div>}
    </div>
  );
}

function GuideStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="settings-guide-block">
      <header><span className="eyebrow">STEP {n}</span><h3>{title}</h3></header>
      {children}
    </section>
  );
}

const apiSetupSteps = [
  { label: "Fork and configure", icon: Github },
  { label: "Create an X app", icon: Code2 },
  { label: "Set environment", icon: Settings },
  { label: "Authorize X", icon: Link2 },
];

function SetupGuide({ onClose, onGoToSettings }: { onClose: () => void; onGoToSettings: () => void }) {
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
        <div><span className="eyebrow">QUICK START</span><h2>Connect your X API</h2><p>About 5 minutes. You keep control of your credentials and API usage.</p></div>
        <ol>{apiSetupSteps.map(({label,icon:Icon}, index) => <li key={label} className={index === step ? "current" : index < step ? "complete" : ""}><i>{index < step ? <Check size={13}/> : <Icon size={13}/>}</i><span><small>STEP {index+1}</small>{label}</span></li>)}</ol>
        <div className="byok-note"><Github size={16}/><div><strong>Why bring your own key?</strong><p>The app stays free and open source. X bills API usage directly to your developer account.</p></div></div>
      </aside>
      <div className="setup-content">
        <header><span className="step-count">{step+1} / {apiSetupSteps.length}</span><button className="icon-btn" onClick={onClose} aria-label="Close setup"><X size={18}/></button></header>
        {step === 0 && <div className="setup-step"><div className="step-icon"><Github size={23}/></div><span className="eyebrow">SELF-HOSTED FIRST</span><h1>Fork and install</h1><p className="lead">Each installation owns its code, database, X usage and secrets. No shared OpenX service receives your credentials.</p><div className="instruction-list"><div><b>1</b><p><strong>Fork the repository</strong><span>Keep your fork private until environment variables are configured.</span></p></div><div><b>2</b><p><strong>Install dependencies</strong><span><code>npm ci</code> then copy <code>.env.example</code> to <code>.env.local</code> (local) or set secrets on your host.</span></p></div><div><b>3</b><p><strong>Generate secrets</strong><span><code>openssl rand -base64 48</code> for SESSION_SECRET and a separate APP_ACCESS_TOKEN. Only an unconfigured, write-disabled demo may omit the access token.</span></p></div><div><b>4</b><p><strong>Migrate the database</strong><span><code>npm run db:migrate:local</code> for dev, <code>db:migrate:remote</code> after creating D1 in production.</span></p></div></div><a className="external-action" href="https://github.com/dg996/OpenX-Growth/fork" target="_blank" rel="noreferrer">Fork on GitHub <ArrowUpRight size={15}/></a></div>}
        {step === 1 && <div className="setup-step"><div className="step-icon"><Code2 size={23}/></div><span className="eyebrow">X DEVELOPER CONSOLE</span><h1>Create your X application</h1><p className="lead">You never paste an X access token manually. OpenX uses OAuth 2.0 + PKCE and stores encrypted tokens after you approve in the browser.</p><div className="instruction-list"><div><b>1</b><p><strong>Open the X Developer Console</strong><span>Create a project and a dedicated app named e.g. “OpenX Growth”.</span></p></div><div><b>2</b><p><strong>Enable OAuth 2.0</strong><span>Under User authentication settings, turn on OAuth 2.0.</span></p></div><div><b>3</b><p><strong>App type: Web App / Single Page App</strong><span>Public clients use PKCE and usually do not need X_CLIENT_SECRET.</span></p></div><div><b>4</b><p><strong>Set permissions to Read and Write</strong><span>Required for sync, publishing and replies.</span></p></div><div><b>5</b><p><strong>Copy the OAuth 2.0 Client ID</strong><span>Paste it into <code>X_CLIENT_ID</code> in your server environment — never in the browser.</span></p></div></div><a className="external-action" href={X_DEV_CONSOLE} target="_blank" rel="noreferrer">Open X Developer Console <ArrowUpRight size={15}/></a><div className="security-note"><Settings size={16}/><p><strong>Dedicated app recommended.</strong><span>Isolates permissions, billing and revocation from your other X integrations.</span></p></div></div>}
        {step === 2 && <div className="setup-step"><div className="step-icon"><Settings size={23}/></div><span className="eyebrow">ENVIRONMENT</span><h1>Register URLs and set secrets</h1><p className="lead">Add these values to <code>.env.local</code> (dev) or your host&apos;s secret manager (production). Restart the server after changes.</p><div className="config-grid"><label className="wide">Website URL<strong>{origin}</strong><small>Set the same value as <code>APP_URL</code> in your environment.</small></label><label className="wide">Callback / Redirect URI<div className="copy-code"><code>{callback}</code><button onClick={()=>void navigator.clipboard.writeText(callback)} aria-label="Copy callback URL"><Link2 size={14}/></button></div><small>Paste this exact URL into the X app OAuth settings. Must match character-for-character.</small></label></div><div className="credential-map"><div><span>ENV VAR</span><strong>X_CLIENT_ID</strong><Link2 size={14}/><span>FROM X</span><strong>OAuth 2.0 Client ID</strong></div><div><span>ENV VAR</span><strong>SESSION_SECRET</strong><Zap size={14}/><span>GENERATE</span><strong>openssl rand -base64 48</strong></div><div><span>ENV VAR</span><strong>APP_URL</strong><Link2 size={14}/><span>YOUR HOST</span><strong>{origin}</strong></div><div><span>ENV VAR</span><strong>CRON_SECRET</strong><Zap size={14}/><span>GENERATE</span><strong>openssl rand -base64 32</strong></div></div><div className="scope-box"><strong>OAuth scopes OpenX requests</strong><div><code>tweet.read</code><code>tweet.write</code><code>users.read</code><code>offline.access</code></div><p><code>offline.access</code> provides a refresh token so sync and publishing keep working without re-login.</p></div></div>}
        {step === 3 && <div className="setup-step"><div className="step-icon"><Link2 size={23}/></div><span className="eyebrow">AUTHORIZE</span><h1>Connect your X account</h1><p className="lead">After env vars are set and the server restarted, open Settings and click <strong>Continue with X</strong>. You will be redirected to X, review permissions, then returned here automatically.</p><div className="instruction-list"><div><b>1</b><p><strong>Click Continue with X</strong><span>Starts OAuth at <code>/api/x/oauth/start</code> with PKCE.</span></p></div><div><b>2</b><p><strong>Approve on X</strong><span>X redirects to <code>{callback}</code> with a one-time authorization code.</span></p></div><div><b>3</b><p><strong>Tokens stored encrypted</strong><span>Access and refresh tokens are AES-GCM sealed with SESSION_SECRET in your D1 database.</span></p></div><div><b>4</b><p><strong>Go to Discover → Sync from X</strong><span>Live ideas, reply opportunities and analytics replace demo data.</span></p></div></div><div className="security-note"><Zap size={16}/><p><strong>No manual token entry.</strong><span>You do not paste bearer tokens into OpenX. Disconnect in Settings revokes the stored session.</span></p></div><button className="primary-btn finish-setup" onClick={finish}>Open Settings <ArrowUpRight size={15}/></button></div>}
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

function WorkspaceSyncNotice({state,error,onRetry,onSettings}:{state:WorkspaceState;error:string;onRetry:()=>void;onSettings:()=>void}) {
  if(state==="unconfigured-demo"||state==="live"||isWorkspaceBlocking(state))return null;
  if(state==="connected-syncing"||state==="live-refreshing")return <section className="workspace-sync-notice" role="status"><CircleGauge size={17}/><div><strong>{state==="live-refreshing"?"Refreshing X data":"First X sync in progress"}</strong><span>{state==="live-refreshing"?"Existing verified data stays available while the read-only refresh runs.":"Local features stay available while OpenX loads the first verified snapshots."}</span></div></section>;
  if(state==="connected-insufficient")return <section className="workspace-sync-notice" role="status"><CircleGauge size={17}/><div><strong>No verified X data yet</strong><span>Drafts and schedules remain available. Run a read-only sync to populate discovery and analytics.</span></div><button className="outline-btn" onClick={onRetry}>Sync now</button></section>;
  const guidance=syncErrorGuidance(error);
  return <section className="workspace-sync-notice error" role="alert"><CircleGauge size={17}/><div><strong>{guidance.title}</strong><span>{guidance.body}</span></div>{guidance.retryable&&<button className="outline-btn" onClick={onRetry}>Retry sync</button>}<button className="outline-btn" onClick={onSettings}>Open Settings</button></section>;
}

function TodaysGrowthPlan({ideas,opportunities,source,aiReady,csrf,onCreate,onReply,onSettings}:{ideas:IdeaSignal[];opportunities:ReplyOpportunity[];source:"demo"|"live";aiReady:boolean;csrf:string;onCreate:(seed:ComposerSeed)=>void;onReply:(opportunity:ReplyOpportunity)=>void;onSettings:()=>void}) {
  const plan=useMemo(()=>buildGrowthPlan(ideas,opportunities),[ideas,opportunities]);
  const [format,setFormat]=useState<"post"|"thread">("post");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const inFlight=useRef(false);
  const guidance=error?aiErrorGuidance(error):null;

  const generate=async()=>{
    if(inFlight.current||!plan.content)return;
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
            ? <div className="growth-plan-actions"><button className="primary-btn" onClick={onSettings}><Link2 size={14}/> Connect X for a live plan</button></div>
            : <div className="growth-plan-actions">
                <button className="outline-btn" onClick={()=>onCreate({parts:[plan.content!.hook],topic:plan.content!.topic,generated:false})}><PenLine size={14}/> Create draft</button>
                {aiReady?<>
                  <div className="growth-plan-formats" role="group" aria-label="AI draft format"><button aria-pressed={format==="post"} disabled={busy} onClick={()=>setFormat("post")}>Post</button><button aria-pressed={format==="thread"} disabled={busy} onClick={()=>setFormat("thread")}>Thread</button></div>
                  <button className="primary-btn" onClick={()=>void generate()} disabled={busy}><Sparkles size={14}/> {busy?"Generating…":"Generate with AI"}</button>
                </>:<div className="growth-plan-ai-off"><span>AI drafting is off</span><button className="text-btn" onClick={onSettings}>Open Settings</button></div>}
              </div>}
          {guidance&&<div className="inline-error growth-plan-error" role="alert">{guidance.message}{guidance.openSettings&&<button className="text-btn" onClick={onSettings}>Open Settings</button>}</div>}
        </>:<div className="growth-plan-empty">No content recommendation yet</div>}
      </section>
      <section className="growth-plan-replies" aria-label="Reply actions">
        <span className="eyebrow">ENGAGE</span>
        {plan.replies.length?plan.replies.map((reply)=><article className="growth-plan-reply" key={reply.id}><div><strong>{reply.name}<small>{reply.handle}</small></strong><p>{reply.post}</p><span>{reply.relevance}% relevance · {reply.reason}</span></div>{source==="live"&&<button className="outline-btn" onClick={()=>onReply(reply)}><MessageCircle size={14}/> Reply</button>}</article>):<div className="growth-plan-empty">No reply opportunities yet</div>}
      </section>
    </div>
  </section>;
}

export default function HomePage() {
  const [view, setView] = useState<View>("Overview");
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
  const [lastSync, setLastSync] = useState<string>();
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
      const statusResponse=await fetch("/api/x/status");
      if(statusResponse.status===401){window.location.href="/login";return}
      const status=statusResponse.ok?await statusResponse.json() as RuntimeStatus:null;
      const [csrfResponse,postsResponse,analyticsPayload]=await Promise.all([fetch("/api/security/csrf"),fetch("/api/posts"),fetchAnalyticsData("28D")]);
      if(csrfResponse.ok)setCsrf(((await csrfResponse.json()) as {token:string}).token);
      if(postsResponse.ok){const payload=await postsResponse.json() as PostsPayload;setContent(status?.demoMode?initialContent:payload.posts.map((post)=>({id:post.id,text:post.text,status:postStatusLabel(post.status),date:post.scheduledAt?new Date(post.scheduledAt).toLocaleString():post.publishedAt?new Date(post.publishedAt).toLocaleString():"—",evergreen:post.evergreen,lastError:post.lastError})))}
      if(analyticsPayload)setAnalytics(analyticsPayload);
      if(status){
        const isConnected=Boolean(status.connected);
        const onboarding=decideOnboarding({statusLoaded:true,connected:isConnected,dismissed:localStorage.getItem(ONBOARDING_STORAGE_KEY)==="true"});
        if(onboarding.persistComplete)localStorage.setItem(ONBOARDING_STORAGE_KEY,"true");
        setSetupGuide(onboarding.open);
        setConnected(isConnected);setRuntimeConfig(status);setStatusLoaded(true);
        if(status.demoMode){setOpportunityData(opportunities);setSignalData(signals)}
        else {setOpportunityData([]);setSignalData([])}
        if(status.connected){
          setSyncing(true);setSyncError("");
          try{
            const payload=await fetchXSync();
            setAccount(payload.account);setOpportunityData(payload.opportunities);setSignalData(payload.ideas);setLastSync(payload.syncedAt);
            const refreshedAnalytics=await fetchAnalyticsData("28D");if(refreshedAnalytics)setAnalytics(refreshedAnalytics);
          }catch(error){setSyncError(sanitizeSyncError(error instanceof Error?error.message:error))}
          finally{setSyncing(false)}
        }
      }
    })();
  }, []);

  const loadPosts=async()=>{const response=await fetch("/api/posts");if(!response.ok)return;const payload=await response.json() as PostsPayload;setContent(payload.posts.map((post)=>({id:post.id,text:post.text,status:postStatusLabel(post.status),date:post.scheduledAt?new Date(post.scheduledAt).toLocaleString():post.publishedAt?new Date(post.publishedAt).toLocaleString():"—",evergreen:post.evergreen,lastError:post.lastError})))};
  const loadAnalytics=async(nextRange=range)=>{const payload=await fetchAnalyticsData(nextRange);if(payload)setAnalytics(payload)};
  const savePost=async(input:SavePostInput)=>{const response=await fetch("/api/posts",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(input)});if(response.ok){await loadPosts();return true}return false};
  const publishPost=async(id:string|number)=>{const response=await fetch(`/api/posts/${id}/publish`,{method:"POST",headers:{"X-CSRF-Token":csrf}});await loadPosts();if(response.ok)await loadAnalytics();return response.ok};
  const sendFeedback=async(type:"idea"|"reply",id:string,vote:number,context:unknown)=>{await fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({targetType:type,targetId:id,vote,context})})};

  const syncFromX = async (force=false) => {
    setSyncing(true); setSyncError("");
    try {
      const payload=await fetchXSync(force);
      setAccount(payload.account); setOpportunityData(payload.opportunities); setSignalData(payload.ideas); setLastSync(payload.syncedAt); setConnected(true); await loadAnalytics();
    } catch (error) {
      setSyncError(sanitizeSyncError(error instanceof Error?error.message:error));
    } finally { setSyncing(false); }
  };

  const openComposer = (seed:ComposerSeed={parts:[""],generated:false}) => { setComposerSeed(seed); };
  const dismissOnboarding=()=>{localStorage.setItem(ONBOARDING_STORAGE_KEY,"true");setSetupGuide(false)};
  const filteredSignals = signalData.filter((signal) => signal.topic.toLowerCase().includes(search.toLowerCase()));
  const visibleContent = content.filter((item) => contentFilter === "All" || item.status === contentFilter);

  const filteredOpportunities = useMemo(() => opportunityData.filter((item) => `${item.name} ${item.post}`.toLowerCase().includes(search.toLowerCase())), [search,opportunityData]);

  const changeView = (next: View) => { setView(next); setSearch(""); };
  const dataSource:"demo"|"live"=runtimeConfig.demoMode?"demo":"live";
  const hasLiveData=Boolean(opportunityData.length>0||signalData.length>0||analytics?.dataStatus==="available");
  const workspaceState=resolveWorkspaceState({status:statusLoaded?{configured:runtimeConfig.configured,demoMode:runtimeConfig.demoMode,connected}:null,syncing,syncError,lastSync,hasLiveData});
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
    {label:"X resources",value:`${analytics.usage.resources}/${analytics.usage.maxResources}`,delta:analytics.usage.warning?`Budget low · ${analytics.usage.remainingResources} resources and ${analytics.usage.remainingWrites} writes left`:`${analytics.usage.requests} requests · ${analytics.usage.writes} write attempts`,icon:Target,provenance:analytics.usage.provenance},
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
          <div className="workspace">{account?.profileImageUrl?<div className="avatar profile-avatar" style={{backgroundImage:`url(${account.profileImageUrl})`}} aria-label={`${account.name} profile image`}/>:<div className="avatar">{account?.name.slice(0,2).toUpperCase()??"YOU"}</div>}<div><strong>{account?.name??"Personal workspace"}</strong><span>{account?`@${account.username} · X`:connected?"X connected":runtimeConfig.demoMode?"Demo workspace":"X not connected"}</span></div><ChevronDown size={15}/></div>
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
          {view==="Settings"
            ? <SettingsView connected={connected} synced={Boolean(lastSync)} config={runtimeConfig} csrf={csrf} onDisconnected={()=>{setConnected(false);setAccount(undefined);setOpportunityData([]);setSignalData([]);setAnalytics(undefined);setLastSync(undefined);setSyncError("")}} onOpenGuide={() => setSetupGuide(true)}/>
            : isWorkspaceBlocking(workspaceState)
              ? <WorkspaceStatePanel state={workspaceState} onSettings={()=>changeView("Settings")}/>
              : <>
          <WorkspaceSyncNotice state={workspaceState} error={syncError} onRetry={()=>void syncFromX(true)} onSettings={()=>changeView("Settings")}/>
          {view === "Overview" && <>
            <TodaysGrowthPlan ideas={signalData} opportunities={opportunityData} source={dataSource} aiReady={runtimeConfig.aiConfigured&&runtimeConfig.aiContentApproved} csrf={csrf} onCreate={openComposer} onReply={setSelectedReply} onSettings={()=>changeView("Settings")}/>
            {liveMetrics.length?<section className="metrics-row">
              {liveMetrics.map(({ label, value, delta, icon: Icon,provenance }) => <article className="metric-card" key={label}><div><span>{label}</span><strong>{value}</strong><small><ArrowUpRight size={12}/>{delta}<em>{provenance?<ProvenanceText provenance={provenance}/>:"demo data"}</em></small></div><div className="metric-icon"><Icon size={18}/></div></article>)}
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

          {view === "Discover" && <DiscoverView signals={filteredSignals} opportunities={filteredOpportunities} source={dataSource} syncing={syncing} error={syncError} lastSync={lastSync} onSync={()=>void syncFromX(true)} onConnect={() => changeView("Settings")} onReply={setSelectedReply} onCreate={(signal) => {void sendFeedback("idea",signal.topic,1,signal);openComposer({parts:[signal.hook],topic:signal.topic,generated:false})}} onFeedback={(signal,vote)=>void sendFeedback("idea",signal.topic,vote,signal)}/>}
          {view === "Content" && <section className="panel full-panel"><ContentTable items={visibleContent} filter={contentFilter} onFilter={setContentFilter} onCreate={() => openComposer()} onPublish={publishPost}/></section>}
          {view === "Schedule" && <ScheduleView items={content.filter((item) => item.status === "Scheduled")} onCreate={() => openComposer()} postingTimes={dataSource==="live"?analytics?.postingTimes:undefined}/>}
          {view === "Analytics" && <AnalyticsView range={range} setRange={changeRange} data={dataSource==="live"?analytics:undefined}/>}
          </>}
        </div>
      </section>
      {composerSeed && <Composer seed={composerSeed} csrf={csrf} evergreenEnabled={runtimeConfig.evergreenEnabled} onClose={() => setComposerSeed(null)} onOpenSettings={()=>{setComposerSeed(null);changeView("Settings")}} onSave={savePost}/>}
      {selectedReply && <ReplyComposer opportunity={selectedReply} live={dataSource === "live"} csrf={csrf} aiRepliesApproved={runtimeConfig.aiRepliesApproved} onFeedback={(vote)=>void sendFeedback("reply",selectedReply.id,vote,selectedReply)} onClose={() => setSelectedReply(undefined)}/>}
      {setupGuide && <SetupGuide onClose={dismissOnboarding} onGoToSettings={() => { setSetupGuide(false); changeView("Settings"); }}/>}
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

function DiscoverView({ signals: rows, opportunities: ops, onCreate, onReply, onSync, onConnect, onFeedback, source, syncing, error, lastSync }: { signals: IdeaSignal[]; opportunities: ReplyOpportunity[]; onCreate: (signal:IdeaSignal) => void; onReply:(item:ReplyOpportunity)=>void; onSync:()=>void; onConnect:()=>void; onFeedback:(signal:IdeaSignal,vote:number)=>void; source:"demo"|"live"; syncing:boolean; error:string; lastSync?:string }) {
  return <div className="discover-layout"><section className="source-banner"><div><DataBadge source={source}/><p>{source === "live" ? `Ideas and replies are ranked from your real X feed${lastSync ? ` · synced ${new Date(lastSync).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : ""}.` : "These are examples. Connect X to derive ideas and reply opportunities from accounts you actually follow."}</p></div>{source === "live" ? <button className="outline-btn" onClick={onSync} disabled={syncing}><CircleGauge size={14}/>{syncing ? "Syncing…" : "Sync from X"}</button> : <button className="primary-btn" onClick={onConnect}><Link2 size={14}/> Connect X</button>}</section>{error && <div className="sync-error">Could not sync: {error}</div>}<section className="panel full-panel"><div className="panel-header"><div><span className="eyebrow">IDEAS FROM YOUR NETWORK</span><h2>What is gaining momentum</h2><p>Topics found in your home timeline and compared with your recent posts.</p></div><button className="outline-btn" onClick={source === "live" ? onSync : onConnect}><CircleGauge size={14}/> {source === "live" ? "Refresh ideas" : "Connect for live ideas"}</button></div><div className="signal-cards">{rows.map((signal, index) => <article key={signal.topic}><div className="signal-rank">0{index+1}</div><Flame size={18}/><div><h3>{signal.topic} <small>{signal.pillar}</small></h3><p>{signal.rationale || signal.change}{signal.algorithmVersion?` · ${signal.algorithmVersion}`:""}</p></div><div className="idea-vote"><button onClick={()=>onFeedback(signal,1)}>👍</button><button onClick={()=>onFeedback(signal,-1)}>👎</button></div><div className="signal-score"><strong>{signal.score}</strong><span><ProvenanceText provenance={signal.scoreProvenance}/></span></div><button className="outline-btn" onClick={() => onCreate(signal)}><Lightbulb size={14}/> Use idea</button></article>)}</div></section><section className="panel full-panel"><OpportunityList items={ops} source={source} onReply={onReply} onView={() => {}}/></section></div>;
}

function ScheduleView({ items, onCreate,postingTimes }: { items: ContentItem[]; onCreate: () => void;postingTimes?:AnalyticsData["postingTimes"] }) {
  const start=new Date();start.setHours(0,0,0,0);const days=Array.from({length:7},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);return date});
  const recommendation=postingTimes?.status==="ready"&&postingTimes.suggestions.length?`Recommended from ${postingTimes.sampleSize} published posts: ${postingTimes.suggestions.slice(0,3).map((item)=>item.label).join(", ")}`:`Insufficient data for posting-time recommendations${postingTimes?` (${postingTimes.sampleSize}/${postingTimes.minimumSamples} published posts)`:""}.`;
  return <section className="panel full-panel calendar-panel"><div className="panel-header"><div><span className="eyebrow">PERSISTENT SCHEDULE</span><h2>Next seven days</h2><p>Scheduled posts are stored in D1 and published by the protected cron endpoint.</p><p><Clock3 size={12}/> {recommendation}</p></div><button className="primary-btn" onClick={onCreate}><Plus size={16}/> Schedule post</button></div><div className="calendar-grid">{days.map((day)=>{const dayItems=items.filter((item)=>item.date!=="—"&&new Date(item.date).toDateString()===day.toDateString());return <div className="calendar-day" key={day.toISOString()}><strong>{day.toLocaleDateString(undefined,{weekday:"short",day:"numeric"}).toUpperCase()}</strong>{dayItems.map((item)=><article key={item.id}><span>{new Date(item.date).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span><p>{item.text}</p>{item.evergreen&&<small>Evergreen</small>}</article>)}</div>})}</div></section>;
}

function AnalyticsView({ range, setRange, data }: { range: string; setRange: (v: string) => void; data?:AnalyticsData }) {
  if(!data||data.dataStatus==="insufficient_data")return <section className="panel full-panel empty-analytics"><BarChart3 size={28}/><h2>Insufficient analytics data</h2><p>Sync X to store real post and follower snapshots. Charts and recommendations appear only when their documented sample thresholds are met.</p></section>;
  const cards=[{label:"Impressions",metric:data.derived.totals.impressions,icon:CircleGauge},{label:"Engagement rate",metric:{...data.derived.totals.engagementRate,value:data.derived.totals.engagementRate.value*100},suffix:"%",icon:Activity},{label:"Replies",metric:data.derived.totals.replies,icon:MessageCircle},{label:"Reposts",metric:data.derived.totals.reposts,icon:TrendingUp}];
  const breakdown=(title:string,rows:AnalyticsBreakdown[])=>{const maximum=Math.max(0,...rows.map((row)=>row.medianEngagementRate.value));return <section className="panel analytics-breakdown"><div className="panel-header"><div><span className="eyebrow">DERIVED FROM X SNAPSHOTS</span><h2>{title}</h2></div></div>{rows.length?rows.slice(0,6).map((row)=><div className="breakdown-row" key={row.label}><span>{row.label}</span><i><b style={{width:`${maximum?Math.max(8,100*(row.medianEngagementRate.value/maximum)):0}%`}}/></i><strong>{(row.medianEngagementRate.value*100).toFixed(2)}%<small><ProvenanceText provenance={row.provenance}/></small></strong></div>):<div className="empty-state">Insufficient data</div>}</section>};
  return <div className="analytics-layout"><section className="metrics-row">{cards.map(({label,metric,suffix="",icon:Icon})=><article className="metric-card" key={label}><div><span>{label}</span><strong>{metric.value.toLocaleString(undefined,{maximumFractionDigits:2})}{suffix}</strong><small><Check size={12}/><ProvenanceText provenance={metric.provenance}/></small></div><div className="metric-icon"><Icon size={18}/></div></article>)}</section><section className="panel full-panel"><div className="panel-header"><div><span className="eyebrow">DERIVED SERIES</span><h2>Impressions over time</h2><p><ProvenanceText provenance={data.derived.totals.impressions.provenance}/></p></div><div className="range-tabs">{["7D","28D","90D","1Y"].map((item)=><button className={range===item?"selected":""} key={item} onClick={()=>setRange(item)}>{item}</button>)}</div></div><div className="large-chart"><DataSeriesChart label="Impressions from X snapshots" points={data.derived.series.map((point)=>({recordedAt:point.recordedAt,value:point.impressions.value}))}/></div></section><div className="analytics-grid">{breakdown("Performance by topic",data.derived.byTopic)}{breakdown("Performance by format",data.derived.byFormat)}{breakdown("Best hooks",data.derived.byHook)}{breakdown("Posting-hour performance",data.derived.byHour)}</div></div>;
}

function SettingsView({ connected, synced, config, csrf, onDisconnected, onOpenGuide }: { connected:boolean;synced:boolean;config:AppRuntimeConfig;csrf:string;onDisconnected:()=>void;onOpenGuide:()=>void }) {
  const [message,setMessage]=useState("");
  const [setupReferenceOpen,setSetupReferenceOpen]=useState(false);
  const [origin] = useState(() => (typeof window === "undefined" ? "https://your-domain.com" : window.location.origin));
  const callback = `${origin}/api/x/oauth/callback`;
  const cronExample = `curl -X POST "${origin}/api/cron/publish" -H "Authorization: Bearer $CRON_SECRET"`;
  const disconnect=async()=>{const response=await fetch("/api/x/disconnect",{method:"POST",headers:{"X-CSRF-Token":csrf}});if(response.ok){onDisconnected();setMessage("X disconnected and stored tokens deleted.")}};
  const deleteAll=async()=>{if(!window.confirm("Delete every local draft, schedule, metric, feedback item, cached X post and OAuth token? This cannot be undone."))return;const response=await fetch("/api/data/delete",{method:"DELETE",headers:{"X-CSRF-Token":csrf}});if(response.ok){onDisconnected();setMessage("All local application data was deleted. Refreshing…");setTimeout(()=>window.location.reload(),700)}else setMessage("Deletion failed.")};
  const importData=async(file:File)=>{try{const payload=JSON.parse(await file.text());const response=await fetch("/api/data/import",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(payload)});const failure=response.ok?undefined:await response.json() as {error?:string};setMessage(response.ok?"Import completed. Refresh to see the data.":`Import failed: ${failure?.error??"unknown error"}`)}catch{setMessage("Invalid JSON export.")}};
  const x=config.xConfiguration;
  const ai=config.aiConfiguration;
  const configured=(value:boolean)=>value?"Configured":"Not configured";
  const protectedConfigured=(value:boolean|undefined)=>value===undefined?"Unavailable in public demo":configured(value);
  return (
    <div className="settings-layout settings-layout-wide">
      <section className="panel settings-card">
        <div className="panel-header">
          <div>
            <span className="eyebrow">CURRENT CONFIGURATION</span>
            <h2>Runtime state</h2>
            <p>This summary is derived from the protected server response. It shows status and safe labels only, never environment values or provider URLs.</p>
          </div>
          <div className={`connection-state ${connected?"is-connected":""}`}><i/>{connected?"Connected to X":"Not connected"}</div>
        </div>

        <div className="config-status">
          <ConfigurationLine label="X account" value={connected?"Connected":"Not connected"} ok={connected}/>
          <ConfigurationLine label="X_CLIENT_ID" value={protectedConfigured(x?.xClientIdConfigured)} ok={Boolean(x?.xClientIdConfigured)}/>
          <ConfigurationLine label="SESSION_SECRET" value={protectedConfigured(x?.sessionSecretConfigured)} ok={Boolean(x?.sessionSecretConfigured)}/>
          <ConfigurationLine label="APP_URL" value={protectedConfigured(x?.appUrlConfigured)} ok={Boolean(x?.appUrlConfigured)}/>
          <ConfigurationLine label="X_CLIENT_SECRET" value={protectedConfigured(x?.xClientSecretConfigured)} ok={Boolean(x?.xClientSecretConfigured)}/>
          <ConfigurationLine label="APP_ACCESS_TOKEN" value={protectedConfigured(x?.appAccessTokenConfigured)} ok={Boolean(x?.appAccessTokenConfigured)}/>
          <ConfigurationLine label="CRON_SECRET" value={protectedConfigured(x?.cronSecretConfigured)} ok={Boolean(x?.cronSecretConfigured)}/>
          <ConfigurationLine label="OPENX_API_TOKEN" value={protectedConfigured(x?.apiTokenConfigured)} ok={Boolean(x?.apiTokenConfigured)}/>
          <ConfigurationLine label="Provider" value={ai?.provider??"Unavailable in public demo"} ok={Boolean(ai)}/>
          <ConfigurationLine label="Model" value={ai?.model??"Unavailable in public demo"} ok={Boolean(ai)}/>
          <ConfigurationLine label="API key" value={configured(ai?.apiKeyConfigured??config.aiConfigured)} ok={ai?.apiKeyConfigured??config.aiConfigured}/>
          <ConfigurationLine label="AI content" value={(ai?.contentApproved??config.aiContentApproved)?"Enabled":"Disabled"} ok={ai?.contentApproved??config.aiContentApproved}/>
          <ConfigurationLine label="AI replies" value={(ai?.repliesApproved??config.aiRepliesApproved)?"Enabled":"Disabled"} ok={ai?.repliesApproved??config.aiRepliesApproved}/>
        </div>

        <button className="setup-help" onClick={onOpenGuide}><Lightbulb size={16}/><span><strong>Prefer a step-by-step wizard?</strong><small>Open the interactive setup guide</small></span><ArrowUpRight size={15}/></button>

        <button className="setup-reference-toggle" onClick={()=>setSetupReferenceOpen((open)=>!open)} aria-expanded={setupReferenceOpen}><span><small>SETUP REFERENCE</small><strong>Installation examples and schema requirements</strong><em>Reference values below are not the current runtime configuration.</em></span><ChevronDown size={16}/></button>
        {setupReferenceOpen&&<div className="setup-reference">
        <GuideStep n={1} title="Create an app in the X Developer Console">
          <div className="instruction-list">
            <div><b>1</b><p><strong>Go to console.x.com</strong><span>Create a project, then a new app dedicated to this OpenX instance.</span></p></div>
            <div><b>2</b><p><strong>User authentication → OAuth 2.0 → Enable</strong><span>Type: Web App or Single Page App. Permissions: <em>Read and write</em>.</span></p></div>
            <div><b>3</b><p><strong>Copy the OAuth 2.0 Client ID</strong><span>This is <code>X_CLIENT_ID</code>. It is public; the secret (if any) stays server-side only.</span></p></div>
            <div><b>4</b><p><strong>Confidential clients only</strong><span>If X shows a Client Secret, set <code>X_CLIENT_SECRET</code> in env. Public PKCE clients can leave it empty.</span></p></div>
          </div>
          <a className="external-action" href={X_DEV_CONSOLE} target="_blank" rel="noreferrer">Open X Developer Console <ArrowUpRight size={15}/></a>
        </GuideStep>

        <GuideStep n={2} title="Register these URLs in your X app">
          <CopyField label="Website URL (also set APP_URL in env)" hint="Must match your deployment origin exactly, no trailing slash." value={origin} />
          <CopyField label="Callback / Redirect URI" hint="Paste into X OAuth settings. OpenX handles the callback at /api/x/oauth/callback." value={callback} />
          <div className="scope-box">
            <strong>OAuth scopes requested by OpenX</strong>
            <div><code>tweet.read</code><code>tweet.write</code><code>users.read</code><code>offline.access</code></div>
            <p><code>offline.access</code> enables refresh tokens for sync, publishing and scheduled posts.</p>
          </div>
        </GuideStep>

        <GuideStep n={3} title="Set environment variables on the server">
          <p className="settings-lead">Copy <code>.env.example</code> to <code>.env.local</code> for development, or use your host&apos;s secret manager in production. <strong>Never commit real values to Git.</strong></p>
          <div className="env-var-list">
            <EnvVarRow name="X_CLIENT_ID" required description="OAuth 2.0 Client ID from the X Developer Console. Enables OAuth start and token exchange." example="X_CLIENT_ID=your_oauth_2_client_id" />
            <EnvVarRow name="SESSION_SECRET" required description="Encrypts OAuth tokens before D1 storage. Generate with: openssl rand -base64 48" example="SESSION_SECRET=a_long_random_string_at_least_32_chars" />
            <EnvVarRow name="APP_URL" required description="Public origin of this deployment. Must match Website URL registered in X." example={`APP_URL=${origin}`} />
            <EnvVarRow name="X_CLIENT_SECRET" description="Only if X treats your app as a confidential OAuth client. Public SPA/PKCE apps skip this." example="X_CLIENT_SECRET=" />
            <EnvVarRow name="APP_ACCESS_TOKEN" required description="Required before configuring X. It may be empty only for the unconfigured, write-disabled public demo." example="APP_ACCESS_TOKEN=a_distinct_random_access_token" />
            <EnvVarRow name="CRON_SECRET" description="Protects POST /api/cron/publish for scheduled publishing. Use a unique random value." example="CRON_SECRET=openssl_rand_base64_32" />
            <EnvVarRow name="OPENX_API_TOKEN" description="Bearer token for REST API and MCP automation. Separate from X credentials." example="OPENX_API_TOKEN=openssl_rand_base64_32" />
          </div>
          <div className="security-note"><Github size={16}/><p><strong>After editing env vars</strong><span>Restart the dev server or redeploy. Settings status lines above should turn green before connecting X.</span></p></div>
        </GuideStep>

        <GuideStep n={4} title="Authorize your X account (OAuth)">
          <div className="instruction-list">
            <div><b>1</b><p><strong>Click Continue with X below</strong><span>Redirects to X login and permission review.</span></p></div>
            <div><b>2</b><p><strong>Approve requested scopes</strong><span>X sends a one-time code to {callback}.</span></p></div>
            <div><b>3</b><p><strong>OpenX exchanges the code</strong><span>Access + refresh tokens are encrypted and stored in your database.</span></p></div>
            <div><b>4</b><p><strong>Discover → Sync from X</strong><span>Replaces demo signals with live ideas and reply opportunities from your home timeline.</span></p></div>
          </div>
          <div className="settings-actions settings-actions-primary">
            {connected
              ? <button className="danger-btn" onClick={disconnect}>Disconnect X and delete tokens</button>
              : <a className={`primary-btn ${!config.configured?"disabled":""}`} href={config.configured?"/api/x/oauth/start":"#"}><Link2 size={16}/> Continue with X</a>}
            <a className="outline-btn" href={X_OAUTH_DOCS} target="_blank" rel="noreferrer">X OAuth docs <ArrowUpRight size={14}/></a>
          </div>
          {!config.configured && <div className="inline-error">Set X_CLIENT_ID and SESSION_SECRET first, then restart the server.</div>}
        </GuideStep>

        <GuideStep n={5} title="Optional — AI writing assistant">
          <p className="settings-lead">AI is off by default. OpenX calls <em>your</em> OpenAI-compatible API; content is never sent to OpenX maintainers.</p>
          <div className="env-var-list">
            <EnvVarRow name="AI_API_KEY" description="API key from OpenAI, OpenRouter, or any OpenAI-compatible provider." example="AI_API_KEY=sk-..." />
            <EnvVarRow name="AI_BASE_URL" description="Provider base URL." example="AI_BASE_URL=https://api.openai.com/v1" />
            <EnvVarRow name="AI_MODEL" description="Model slug used for suggestions in the composer." example="AI_MODEL=gpt-4o-mini" />
            <EnvVarRow name="X_AI_CONTENT_APPROVED" description="Set to true only after you confirm your X developer use case permits AI-assisted drafting." example="X_AI_CONTENT_APPROVED=false" />
            <EnvVarRow name="X_AI_REPLIES_APPROVED" description="Set to true only if AI-assisted reply suggestions are permitted for your use case." example="X_AI_REPLIES_APPROVED=false" />
          </div>
          <div className="security-note"><Sparkles size={16}/><p><strong>Human review required</strong><span>AI output is always labeled and must be edited before publish. No autonomous replies or DMs.</span></p></div>
        </GuideStep>

        <GuideStep n={6} title="Optional — Scheduled publishing">
          <p className="settings-lead">Schedule posts in the composer, then call the protected cron endpoint every 5 minutes from GitHub Actions, cron, or your host.</p>
          <CopyField label="Cron publish command" hint="Replace $CRON_SECRET with the value from your environment." value={cronExample} />
        </GuideStep>

        <GuideStep n={7} title="Data controls">
          <div className="settings-actions">
            <a className="outline-btn" href="/api/data/export" download>Export all data</a>
            <label className="outline-btn file-button">Import JSON<input type="file" accept="application/json" onChange={(event)=>{const file=event.target.files?.[0];if(file)void importData(file)}}/></label>
            <button className="danger-btn" onClick={deleteAll}>Delete all local data</button>
            <a className="outline-btn" href="/privacy">Privacy notice</a>
          </div>
          {message && <div className="form-disclaimer"><Check size={14}/><span>{message}</span></div>}
        </GuideStep>
        </div>}
      </section>

      <aside className="panel principle-card settings-checklist">
        <Code2 size={22}/>
        <h3>Quick checklist</h3>
        <ol className="setup-checklist">
          <li className={config.configured?"done":""}>X app created + Client ID copied</li>
          <li className={config.configured?"done":""}>Callback URL registered in X</li>
          <li className={config.configured?"done":""}>SESSION_SECRET generated</li>
          <li className={connected?"done":""}>Continue with X completed</li>
          <li className={synced?"done":""}>Discover → Sync from X</li>
          <li>Content → create draft → publish test</li>
        </ol>
        <p>OAuth tokens never appear in the UI or exports. Disconnect removes encrypted tokens from your database.</p>
        <a href="https://github.com/dg996/OpenX-Growth/blob/main/SECURITY.md" target="_blank" rel="noreferrer">Security model <ArrowUpRight size={13}/></a>
      </aside>
    </div>
  );
}

function ConfigurationLine({ok,label,value}:{ok:boolean;label:string;value:string}) {
  return <div className={ok?"ok":"neutral"}>{ok?<Check size={14}/>:<CircleGauge size={14}/>}<span>{label}</span><b>{value}</b></div>;
}
