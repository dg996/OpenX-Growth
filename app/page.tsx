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
import { useEffect, useMemo, useState } from "react";
import type { IdeaSignal, ReplyOpportunity } from "../lib/x-growth";

type View = "Overview" | "Discover" | "Content" | "Schedule" | "Analytics" | "Settings";
type PostStatus = "Draft" | "Scheduled" | "Publishing" | "Published" | "Failed";

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
type AppRuntimeConfig={configured:boolean;accessProtected:boolean;aiConfigured:boolean;aiContentApproved:boolean;aiRepliesApproved:boolean;evergreenEnabled:boolean;syncTtlSeconds:number};
type AnalyticsData={source:string;totals:{impressions:number;likes:number;replies:number;reposts:number};byTopic:Array<{label:string;posts:number;impressions:number;engagements:number}>;byFormat:Array<{label:string;posts:number;impressions:number;engagements:number}>;byHook:Array<{label:string;posts:number;impressions:number;engagements:number}>;byHour:Array<{label:string;posts:number;impressions:number;engagements:number}>;usage:{reads:number;writes:number;maxReads:number;maxWrites:number}};
type AccountProfile={id:string;name:string;username:string;profileImageUrl?:string};
type StoredPost={id:string;text:string;status:string;scheduledAt?:number;publishedAt?:number;evergreen?:boolean;lastError?:string};
type PostsPayload={posts:StoredPost[]};
type SyncPayload={account:AccountProfile;opportunities:ReplyOpportunity[];ideas:IdeaSignal[];syncedAt:string;error?:string};
type AiPayload={content?:string|string[];error?:string};

const navItems = [
  { label: "Overview" as View, icon: Home },
  { label: "Discover" as View, icon: Flame },
  { label: "Content" as View, icon: FileText },
  { label: "Schedule" as View, icon: CalendarDays },
  { label: "Analytics" as View, icon: BarChart3 },
];

const signals: IdeaSignal[] = [
  { topic: "Open source AI", change: "Demo topic · connect X for live data", score: 92, bars: [4, 7, 9, 12, 14, 13, 10, 8, 9, 11, 14, 16, 18], hook:"Most people misunderstand open source AI. Here is what they miss:", rationale:"Demo idea",pillar:"Industry insight" },
  { topic: "Build in public", change: "Demo topic · connect X for live data", score: 78, bars: [3, 5, 8, 9, 8, 7, 6, 5, 7, 8, 10, 12, 15], hook:"Building in public is not a content strategy. It is a feedback loop.", rationale:"Demo idea",pillar:"Build in public" },
  { topic: "AI agents", change: "Demo topic · connect X for live data", score: 65, bars: [4, 8, 6, 10, 7, 9, 8, 6, 9, 12, 10, 11, 15], hook:"AI agents are about to change the size of the average startup team.", rationale:"Demo idea",pillar:"Product thesis" },
  { topic: "European tech", change: "Demo topic · connect X for live data", score: 54, bars: [3, 4, 5, 7, 6, 8, 7, 9, 8, 10, 11, 12, 13], hook:"Europe does not have a talent problem. It has a distribution problem.", rationale:"Demo idea",pillar:"Industry insight" },
  { topic: "Founder-led growth", change: "Demo topic · connect X for live data", score: 41, bars: [2, 4, 5, 4, 7, 6, 9, 8, 7, 9, 10, 11, 12], hook:"Founder-led growth works because customers want proximity to conviction.", rationale:"Demo idea",pillar:"Founder lesson" },
];

const opportunities: ReplyOpportunity[] = [
  { id:"demo-1", initials:"SB",name:"Sample Builder",handle:"@samplebuilder",post:"What is one underrated habit that changed how you build products?",reach:"48K",relevance:92,url:"https://x.com",suggestedReply:"",reason:"Demo opportunity · connect X for live ranking" },
  { id:"demo-2", initials:"OF",name:"Open Founder",handle:"@openfounder",post:"Open source is becoming a distribution advantage, not only a licensing choice.",reach:"32K",relevance:88,url:"https://x.com",suggestedReply:"",reason:"Demo opportunity · connect X for live ranking" },
  { id:"demo-3", initials:"IP",name:"Indie Product",handle:"@indieproduct",post:"Building in public works best when the feedback changes the product.",reach:"24K",relevance:85,url:"https://x.com",suggestedReply:"",reason:"Demo opportunity · connect X for live ranking" },
  { id:"demo-4", initials:"SG",name:"SaaS Growth",handle:"@saasgrowth",post:"Founders: what is your most reliable growth loop right now?",reach:"19K",relevance:82,url:"https://x.com",suggestedReply:"",reason:"Demo opportunity · connect X for live ranking" },
];

const initialContent: ContentItem[] = [
  { id: 1, text: "The 3 metrics I track weekly to grow on X", status: "Draft", date: "—" },
  { id: 2, text: "How I went from 0 to 10K followers in 90 days", status: "Scheduled", date: "Jul 12, 10:00" },
  { id: 3, text: "Stop posting content. Start building trust.", status: "Scheduled", date: "Jul 13, 09:30" },
  { id: 4, text: "5 lessons from shipping 10 indie projects", status: "Published", date: "Jul 10, 08:12", rate: "4.1%", impressions: "18.7K" },
  { id: 5, text: "Thread: my favorite open-source tools in 2026", status: "Published", date: "Jul 8, 07:45", rate: "3.7%", impressions: "22.3K" },
];

const metricData = [
  { label: "Followers", value: "12,842", delta: "5.2%", icon: Users },
  { label: "Impressions", value: "1.28M", delta: "18.7%", icon: CircleGauge },
  { label: "Engagement rate", value: "3.6%", delta: "0.6pp", icon: Activity },
  { label: "Profile visits", value: "24,731", delta: "12.3%", icon: Target },
];

function Logo() {
  return <div className="brand-mark" aria-label="OpenX Growth logo"><span>O</span><span>X</span></div>;
}

function GrowthChart({ range }: { range: string }) {
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

function Composer({ onClose, onSave, initialText, csrf, evergreenEnabled }: { onClose: () => void; onSave: (post:SavePostInput) => Promise<boolean>; initialText?: string; csrf:string;evergreenEnabled:boolean }) {
  const [parts,setParts] = useState([initialText || ""]); const [scheduled,setScheduled]=useState(false); const [scheduledAt,setScheduledAt]=useState(""); const [evergreen,setEvergreen]=useState(false); const [interval,setInterval]=useState(30); const [generated,setGenerated]=useState(false); const [busy,setBusy]=useState(false); const [done,setDone]=useState(false); const [error,setError]=useState("");
  const updatePart=(index:number,value:string)=>setParts((current)=>current.map((part,position)=>position===index?value:part));
  const improve=async(kind:string)=>{setBusy(true);setError("");const response=await fetch("/api/ai/generate",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({kind:parts.length>1?"thread":"rewrite",prompt:`${kind}: ${parts.join("\n---\n")}`})});const payload=await response.json() as AiPayload;setBusy(false);if(!response.ok||payload.content===undefined){setError(payload.error??"AI unavailable");return}const content=payload.content;if(Array.isArray(content))setParts(content);else setParts([String(content)]);setGenerated(true)};
  const submit=async()=>{const clean=parts.map((part)=>part.trim()).filter(Boolean);if(!clean.length||clean.some((part)=>part.length>280))return;setBusy(true);setError("");const ok=await onSave({text:clean[0],thread:clean,scheduledAt:scheduled&&scheduledAt?new Date(scheduledAt).getTime():undefined,evergreen,evergreenIntervalDays:interval,generated,hook:clean[0].split("\n")[0]});setBusy(false);if(ok){setDone(true);setTimeout(onClose,650)}else setError("Could not save this post.")};
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="composer" onMouseDown={(e) => e.stopPropagation()} aria-modal="true" role="dialog">
        <header><div><span className="eyebrow">COMPOSE</span><h2>Create a post</h2></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></header>
        <div className="composer-profile"><div className="avatar lime-avatar">YOU</div><div><strong>Your account</strong><span>@connected_account</span></div></div>
        <div className="thread-editor">{parts.map((part,index)=><div className="thread-part" key={index}><span>{index+1}</span><textarea value={part} onChange={(event)=>updatePart(index,event.target.value)} autoFocus={index===0} maxLength={280} placeholder={index===0?"Write your post…":"Continue the thread…"}/><small>{part.length}/280</small>{parts.length>1&&<button onClick={()=>setParts((current)=>current.filter((_,position)=>position!==index))} aria-label={`Remove part ${index+1}`}><X size={13}/></button>}</div>)}</div>
        <div className="composer-toolbar"><button className="outline-btn" onClick={()=>setParts((current)=>[...current,""])}><Plus size={14}/> Add thread post</button><div className="ai-tools"><button disabled={busy} onClick={()=>improve("Write a stronger hook")}><Sparkles size={14}/> Stronger hook</button><button disabled={busy} onClick={()=>improve("Shorten and clarify")}><Zap size={14}/> Shorten</button><button disabled={busy} onClick={()=>improve("Match my writing voice")}><PenLine size={14}/> Match my voice</button></div></div>
        <div className="publish-options"><label><input type="checkbox" checked={scheduled} onChange={(event)=>setScheduled(event.target.checked)}/> Schedule</label>{scheduled&&<input type="datetime-local" value={scheduledAt} onChange={(event)=>setScheduledAt(event.target.value)} min={new Date().toISOString().slice(0,16)}/>} {evergreenEnabled&&<><label><input type="checkbox" checked={evergreen} onChange={(event)=>setEvergreen(event.target.checked)}/> Evergreen</label>{evergreen&&<label>Repeat every <input type="number" min="7" value={interval} onChange={(event)=>setInterval(Number(event.target.value))}/> days</label>}</>}</div>
        {generated&&<div className="generated-notice"><Sparkles size={13}/> AI-generated suggestion — review every part before publishing.</div>}{error&&<div className="inline-error">{error}</div>}
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
  const suggest=async()=>{setSending(true);const response=await fetch("/api/ai/generate",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({kind:"reply",prompt:"Draft a useful, specific reply for human review",context:opportunity.post})});const payload=await response.json() as AiPayload;setSending(false);if(response.ok&&payload.content!==undefined){setText(String(payload.content));setGenerated(true)}else setResult("error")};
  const send = async () => {
    if (!live) { window.open(opportunity.url,"_blank","noopener,noreferrer"); return; }
    setSending(true); setResult(null);
    const response = await fetch("/api/x/reply",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({postId:opportunity.id,text,generated})});
    setSending(false); setResult(response.ok ? "sent" : "error");
    if (response.ok) setTimeout(onClose,800);
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="composer reply-composer" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Write reply"><header><div><span className="eyebrow">REPLY TO {opportunity.handle.toUpperCase()}</span><h2>Join the conversation</h2></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></header><div className="quoted-post"><strong>{opportunity.name} <small>{opportunity.handle}</small></strong><p>{opportunity.post}</p><em>{opportunity.reason}</em></div><label className="reply-label">YOUR REPLY<textarea value={text} onChange={(event)=>{setText(event.target.value);if(!event.target.value)setGenerated(false)}} maxLength={280} placeholder="Write a specific, useful reply…"/></label>{aiRepliesApproved&&<button className="outline-btn ai-reply-btn" onClick={suggest} disabled={sending}><Sparkles size={14}/> Suggest with AI</button>}{generated&&<div className="generated-notice"><Sparkles size={13}/> AI-generated suggestion — edit and review before publishing.</div>}<div className="composer-meta"><span>{text.length}/280</span><span>{live?"Publishes only after your confirmation":"Demo mode · opens the post on X"}</span></div><div className="feedback-actions"><span>Was this opportunity relevant?</span><button onClick={()=>onFeedback(1)}>👍</button><button onClick={()=>onFeedback(-1)}>👎</button></div>{result==="error"&&<div className="inline-error">The action failed. Check approval, permissions and connection status.</div>}<footer><button className="ghost-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={send} disabled={sending||!text.trim()}>{result==="sent"?<><Check size={15}/> Sent</>:sending?"Sending…":live?<><Send size={15}/> Publish reply</>:<><ArrowUpRight size={15}/> Open on X</>}</button></footer></section></div>;
}

const apiSetupSteps = [
  { label: "Fork and configure", icon: Github },
  { label: "Create an X app", icon: Code2 },
  { label: "Set environment", icon: Settings },
  { label: "Authorize X", icon: Link2 },
];

function SetupGuide({ onClose, onGoToSettings }: { onClose: () => void; onGoToSettings: () => void }) {
  const [step, setStep] = useState(0);
  const [origin] = useState(()=>typeof window!=="undefined"?window.location.origin:"https://your-domain.com");
  const callback = `${origin}/api/auth/x/callback`;
  const finish = () => {
    localStorage.setItem("openx-onboarding-complete", "true");
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
        {step === 0 && <div className="setup-step"><div className="step-icon"><Github size={23}/></div><span className="eyebrow">SELF-HOSTED FIRST</span><h1>Fork OpenX Growth</h1><p className="lead">Each installation owns its code, database, X usage and secrets. No shared OpenX service receives your credentials. Review the <a href="/privacy" target="_blank">privacy notice</a> before connecting an account.</p><div className="instruction-list"><div><b>1</b><p><strong>Fork the GitHub repository</strong><span>Keep your fork private until its environment variables are configured.</span></p></div><div><b>2</b><p><strong>Copy .env.example to .env.local</strong><span>Generate fresh SESSION_SECRET, APP_ACCESS_TOKEN and CRON_SECRET values.</span></p></div><div><b>3</b><p><strong>Never commit .env files</strong><span>The included gitignore and secret-scanning workflow help prevent accidental exposure.</span></p></div></div><a className="external-action" href="https://github.com/dg996/OpenX-Growth/fork" target="_blank" rel="noreferrer">Fork on GitHub <ArrowUpRight size={15}/></a></div>}
        {step === 1 && <div className="setup-step"><div className="step-icon"><Code2 size={23}/></div><span className="eyebrow">APP CREATION</span><h1>Create a dedicated X app</h1><p className="lead">Create a separate app for OpenX Growth so its permissions and costs stay isolated.</p><div className="instruction-list"><div><b>1</b><p><strong>Click “New App”</strong><span>Name it “OpenX Growth” or choose any recognizable name.</span></p></div><div><b>2</b><p><strong>Select Single Page App</strong><span>This is a public OAuth client and works securely with PKCE without importing a Client Secret.</span></p></div><div><b>3</b><p><strong>Open User authentication settings</strong><span>Enable OAuth 2.0 and keep the generated Client ID.</span></p></div></div><div className="security-note"><Settings size={16}/><p><strong>Use a dedicated app.</strong><span>It makes revoking access and tracking costs much easier.</span></p></div></div>}
        {step === 2 && <div className="setup-step"><div className="step-icon"><Settings size={23}/></div><span className="eyebrow">ENVIRONMENT</span><h1>Configure the deployment</h1><p className="lead">Add the X Client ID and generated secrets to your hosting provider. OpenX never reads them from the browser.</p><div className="config-grid"><label>X application<strong>X_CLIENT_ID</strong></label><label>Encryption key<strong>SESSION_SECRET</strong></label><label>Private access<strong>APP_ACCESS_TOKEN</strong></label><label>Scheduler protection<strong>CRON_SECRET</strong></label><label className="wide">Callback / Redirect URI<div className="copy-code"><code>{callback}</code><button onClick={()=>navigator.clipboard.writeText(callback)} aria-label="Copy callback URL"><Link2 size={14}/></button></div><small>Register this exact value in X.</small></label></div><div className="scope-box"><strong>Scopes requested</strong><div><code>tweet.read</code><code>tweet.write</code><code>users.read</code><code>offline.access</code></div></div></div>}
        {step === 3 && <div className="setup-step"><div className="step-icon"><Link2 size={23}/></div><span className="eyebrow">AUTHORIZE</span><h1>Connect the account on X</h1><p className="lead">Restart the deployment, open Settings and select Continue with X. Review every requested permission on X before approving.</p><div className="security-note"><Zap size={16}/><p><strong>Tokens are encrypted with AES-GCM.</strong><span>Disconnecting deletes the encrypted server-side token. Publishing and replies always require an explicit user action or protected scheduler.</span></p></div><button className="primary-btn finish-setup" onClick={finish}>Open Settings <ArrowUpRight size={15}/></button></div>}
        <footer><button className="ghost-btn" onClick={onClose}>I&apos;ll do this later</button><div><button className="outline-btn" disabled={step === 0} onClick={() => setStep((value) => Math.max(0,value-1))}>Back</button>{step < apiSetupSteps.length-1 && <button className="primary-btn" onClick={() => setStep((value) => value+1)}>Continue <ArrowUpRight size={14}/></button>}</div></footer>
      </div>
    </section>
  </div>;
}

export default function HomePage() {
  const [view, setView] = useState<View>("Overview");
  const [range, setRange] = useState("28D");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState(false);
  const [composerSeed, setComposerSeed] = useState<string>();
  const [content, setContent] = useState(initialContent);
  const [contentFilter, setContentFilter] = useState("All");
  const [connected, setConnected] = useState(false);
  const [setupGuide, setSetupGuide] = useState(()=>typeof window!=="undefined"&&localStorage.getItem("openx-onboarding-complete")!=="true");
  const [theme, setTheme] = useState<"dark" | "light">(()=>typeof window!=="undefined"?(localStorage.getItem("openx-theme") as "dark"|"light"|null)??(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):"dark");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unread, setUnread] = useState(3);
  const [opportunityData, setOpportunityData] = useState<ReplyOpportunity[]>(opportunities);
  const [signalData, setSignalData] = useState<IdeaSignal[]>(signals);
  const [dataSource, setDataSource] = useState<"demo"|"live">("demo");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState<string>();
  const [selectedReply, setSelectedReply] = useState<ReplyOpportunity>();
  const [csrf,setCsrf]=useState("");
  const [runtimeConfig,setRuntimeConfig]=useState<AppRuntimeConfig>({configured:false,accessProtected:false,aiConfigured:false,aiContentApproved:false,aiRepliesApproved:false,evergreenEnabled:false,syncTtlSeconds:900});
  const [analytics,setAnalytics]=useState<AnalyticsData>();
  const [account,setAccount]=useState<AccountProfile>();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    void (async()=>{
      const [csrfResponse,statusResponse,postsResponse,analyticsResponse]=await Promise.all([fetch("/api/security/csrf"),fetch("/api/x/status"),fetch("/api/posts"),fetch("/api/analytics")]);
      if(statusResponse.status===401){window.location.href="/login";return}
      if(csrfResponse.ok)setCsrf(((await csrfResponse.json()) as {token:string}).token);
      if(postsResponse.ok){const payload=await postsResponse.json() as PostsPayload;setContent(payload.posts.map((post)=>({id:post.id,text:post.text,status:post.status.charAt(0).toUpperCase()+post.status.slice(1) as PostStatus,date:post.scheduledAt?new Date(post.scheduledAt).toLocaleString():post.publishedAt?new Date(post.publishedAt).toLocaleString():"—",evergreen:post.evergreen,lastError:post.lastError})))}
      if(analyticsResponse.ok)setAnalytics(await analyticsResponse.json() as AnalyticsData);
      if(statusResponse.ok){const status=await statusResponse.json() as AppRuntimeConfig&{connected:boolean};setConnected(Boolean(status.connected));setRuntimeConfig(status);if(status.connected){const response=await fetch("/api/x/sync");if(response.ok){const payload=await response.json() as SyncPayload;setAccount(payload.account);setOpportunityData(payload.opportunities);setSignalData(payload.ideas);setDataSource("live");setLastSync(payload.syncedAt)}}}
    })();
  }, []);

  const loadPosts=async()=>{const response=await fetch("/api/posts");if(!response.ok)return;const payload=await response.json() as PostsPayload;setContent(payload.posts.map((post)=>({id:post.id,text:post.text,status:post.status.charAt(0).toUpperCase()+post.status.slice(1) as PostStatus,date:post.scheduledAt?new Date(post.scheduledAt).toLocaleString():post.publishedAt?new Date(post.publishedAt).toLocaleString():"—",evergreen:post.evergreen,lastError:post.lastError})))};
  const loadAnalytics=async()=>{const response=await fetch("/api/analytics");if(response.ok)setAnalytics(await response.json() as AnalyticsData)};
  const savePost=async(input:SavePostInput)=>{const response=await fetch("/api/posts",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(input)});if(response.ok){await loadPosts();return true}return false};
  const publishPost=async(id:string|number)=>{const response=await fetch(`/api/posts/${id}/publish`,{method:"POST",headers:{"X-CSRF-Token":csrf}});await loadPosts();if(response.ok)await loadAnalytics();return response.ok};
  const sendFeedback=async(type:"idea"|"reply",id:string,vote:number,context:unknown)=>{await fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({targetType:type,targetId:id,vote,context})})};

  const syncFromX = async (force=false) => {
    setSyncing(true); setSyncError("");
    try {
      const response = await fetch(`/api/x/sync${force?"?force=1":""}`);
      const payload = await response.json() as SyncPayload;
      if (!response.ok) throw new Error(payload.error ?? "Sync failed");
      setAccount(payload.account); setOpportunityData(payload.opportunities); setSignalData(payload.ideas); setDataSource("live"); setLastSync(payload.syncedAt); setConnected(true); await loadAnalytics();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Could not sync X");
    } finally { setSyncing(false); }
  };

  const openComposer = (seed?: string) => { setComposerSeed(seed); setComposer(true); };
  const filteredSignals = signalData.filter((signal) => signal.topic.toLowerCase().includes(search.toLowerCase()));
  const visibleContent = content.filter((item) => contentFilter === "All" || item.status === contentFilter);

  const filteredOpportunities = useMemo(() => opportunityData.filter((item) => `${item.name} ${item.post}`.toLowerCase().includes(search.toLowerCase())), [search,opportunityData]);

  const changeView = (next: View) => { setView(next); setSearch(""); };
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
  const liveMetrics=analytics?[{label:"Published posts",value:String(content.filter((item)=>item.status==="Published").length),delta:"live",icon:FileText},{label:"Impressions",value:analytics.totals.impressions.toLocaleString(),delta:"synced",icon:CircleGauge},{label:"Engagements",value:(analytics.totals.likes+analytics.totals.replies+analytics.totals.reposts).toLocaleString(),delta:"synced",icon:Activity},{label:"API usage",value:`${analytics.usage.reads}/${analytics.usage.maxReads}`,delta:"reads today",icon:Target}]:metricData;
  const notificationItems=[...content.filter((item)=>item.status==="Failed").slice(0,2).map((item)=>({view:"Content" as View,title:"Publishing failed",body:item.lastError??item.text,time:"Needs attention",icon:Zap})),...content.filter((item)=>item.status==="Scheduled").slice(0,2).map((item)=>({view:"Schedule" as View,title:"Post scheduled",body:item.text,time:item.date,icon:CalendarDays})),...(lastSync?[{view:"Discover" as View,title:"X feed synchronized",body:`Ideas and reply opportunities refreshed from X.`,time:new Date(lastSync).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),icon:Flame}]:[])];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Logo/><span>OpenX Growth</span></div>
        <a className="open-source" href="https://github.com/dg996/OpenX-Growth" target="_blank" rel="noreferrer"><Github size={15}/><span>Open source</span><small>v0.1.0</small></a>
        <nav>
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={view === label ? "active" : ""} onClick={() => changeView(label)}><Icon size={18}/><span>{label}</span>{label === "Discover" && <i>5</i>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <button className={view === "Settings" ? "active" : ""} onClick={() => changeView("Settings")}><Settings size={18}/><span>Settings</span></button>
          <div className="workspace">{account?.profileImageUrl?<div className="avatar profile-avatar" style={{backgroundImage:`url(${account.profileImageUrl})`}} aria-label={`${account.name} profile image`}/>:<div className="avatar">{account?.name.slice(0,2).toUpperCase()??"YOU"}</div>}<div><strong>{account?.name??"Personal workspace"}</strong><span>{account?`@${account.username} · X`:connected?"X connected":"Demo workspace"}</span></div><ChevronDown size={15}/></div>
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
          {view === "Overview" && <>
            <section className="metrics-row">
              {liveMetrics.map(({ label, value, delta, icon: Icon }) => <article className="metric-card" key={label}><div><span>{label}</span><strong>{value}</strong><small><ArrowUpRight size={12}/>{delta}<em>{analytics?"":"demo data"}</em></small></div><div className="metric-icon"><Icon size={18}/></div></article>)}
            </section>

            <section className="overview-grid">
              <article className="panel growth-panel">
                <div className="panel-header"><div><span className="eyebrow">AUDIENCE</span><h2>Follower growth</h2></div><div className="range-tabs">{["7D","28D","90D","1Y"].map((item) => <button className={range === item ? "selected" : ""} key={item} onClick={() => setRange(item)}>{item}</button>)}</div></div>
                <div className="chart-summary"><strong>12,842</strong><span><TrendingUp size={13}/> +634 this period</span></div>
                <GrowthChart range={range}/>
              </article>

              <article className="panel signals-panel">
                <div className="panel-header"><div><span className="eyebrow">DISCOVER</span><h2>Viral signals <DataBadge source={dataSource}/></h2></div><button className="text-btn" onClick={() => changeView("Discover")}>View all <ArrowUpRight size={13}/></button></div>
                <div className="signal-heading"><span>TOPIC</span><span>VELOCITY</span><span>SCORE</span></div>
                {filteredSignals.slice(0,5).map((signal) => <div className="signal-row" key={signal.topic}><div className="signal-name"><Flame size={15}/><div><strong>{signal.topic}</strong><span>{signal.change}</span></div></div><div className="microbars">{signal.bars.map((bar,i) => <i key={i} style={{height: `${bar}px`}}/>)}</div><b>{signal.score}</b></div>)}
              </article>

              <article className="panel content-panel"><ContentTable items={visibleContent.slice(0,5)} filter={contentFilter} onFilter={setContentFilter} onCreate={() => openComposer()} onPublish={publishPost}/></article>
              <article className="panel opportunities-panel"><OpportunityList items={filteredOpportunities} source={dataSource} onView={() => changeView("Discover")} onReply={setSelectedReply}/></article>
            </section>
          </>}

          {view === "Discover" && <DiscoverView signals={filteredSignals} opportunities={filteredOpportunities} source={dataSource} syncing={syncing} error={syncError} lastSync={lastSync} onSync={()=>void syncFromX(true)} onConnect={() => changeView("Settings")} onReply={setSelectedReply} onCreate={(signal) => {void sendFeedback("idea",signal.topic,1,signal);openComposer(signal.hook)}} onFeedback={(signal,vote)=>void sendFeedback("idea",signal.topic,vote,signal)}/>}
          {view === "Content" && <section className="panel full-panel"><ContentTable items={visibleContent} filter={contentFilter} onFilter={setContentFilter} onCreate={() => openComposer()} onPublish={publishPost}/></section>}
          {view === "Schedule" && <ScheduleView items={content.filter((item) => item.status === "Scheduled")} onCreate={() => openComposer()}/>}
          {view === "Analytics" && <AnalyticsView range={range} setRange={setRange} data={analytics}/>}
          {view === "Settings" && <SettingsView connected={connected} config={runtimeConfig} csrf={csrf} onDisconnected={()=>{setConnected(false);setAccount(undefined);setDataSource("demo")}} onOpenGuide={() => setSetupGuide(true)}/>}
        </div>
      </section>
      {composer && <Composer initialText={composerSeed} csrf={csrf} evergreenEnabled={runtimeConfig.evergreenEnabled} onClose={() => setComposer(false)} onSave={savePost}/>}
      {selectedReply && <ReplyComposer opportunity={selectedReply} live={dataSource === "live"} csrf={csrf} aiRepliesApproved={runtimeConfig.aiRepliesApproved} onFeedback={(vote)=>void sendFeedback("reply",selectedReply.id,vote,selectedReply)} onClose={() => setSelectedReply(undefined)}/>}
      {setupGuide && <SetupGuide onClose={() => setSetupGuide(false)} onGoToSettings={() => { setSetupGuide(false); changeView("Settings"); }}/>}
    </main>
  );
}

function ContentTable({ items, filter, onFilter, onCreate, onPublish }: { items: ContentItem[]; filter: string; onFilter: (v: string) => void; onCreate: () => void; onPublish:(id:string|number)=>Promise<boolean> }) {
  return <div><div className="panel-header"><div><span className="eyebrow">PUBLISH</span><h2>Content queue</h2></div><button className="outline-btn" onClick={onCreate}><PenLine size={14}/> Create post</button></div><div className="content-tabs">{["All","Draft","Scheduled","Published","Failed"].map((tab) => <button className={filter === tab ? "selected" : ""} key={tab} onClick={() => onFilter(tab)}>{tab}</button>)}</div><div className="content-table"><div className="content-row content-head"><span>CONTENT</span><span>STATUS</span><span>DATE</span><span>EVERGREEN</span><span>RESULT</span><span/></div>{items.map((item) => <div className="content-row" key={item.id}><strong title={item.lastError||item.text}>{item.text}</strong><span className={`status ${item.status.toLowerCase()}`}><i/>{item.status}</span><span>{item.date}</span><span>{item.evergreen?"Yes":"—"}</span><span>{item.lastError??item.impressions??"—"}</span>{["Draft","Failed"].includes(item.status)?<button className="row-action" onClick={()=>void onPublish(item.id)}>{item.status==="Failed"?"Retry":"Publish"}</button>:<button className="plain-icon"><MoreHorizontal size={16}/></button>}</div>)}</div>{items.length === 0 && <div className="empty-state">No posts in this view.</div>}</div>;
}

function DataBadge({source}:{source:"demo"|"live"}) { return <span className={`data-badge ${source}`}>{source === "live" ? <><i/> LIVE FROM X</> : "DEMO DATA"}</span>; }

function OpportunityList({ items, onView, onReply, source }: { items: ReplyOpportunity[]; onView: () => void; onReply: (item:ReplyOpportunity) => void; source:"demo"|"live" }) {
  return <div><div className="panel-header"><div><span className="eyebrow">ENGAGE</span><h2>Best reply opportunities <DataBadge source={source}/></h2></div><button className="text-btn" onClick={onView}>View all <ArrowUpRight size={13}/></button></div><div className="opportunity-head"><span>AUTHOR & POST</span><span>EST. REACH</span><span>RELEVANCE</span></div>{items.slice(0,4).map((item) => <div className="opportunity-row" key={item.id}><div className="author"><div className="avatar">{item.initials}</div><div><strong>{item.name}<small>{item.handle}</small></strong><p>{item.post}</p></div></div><span>{item.reach}</span><b>{item.relevance}%</b><button className="outline-btn" onClick={() => onReply(item)}><MessageCircle size={14}/> Reply</button></div>)}</div>;
}

function DiscoverView({ signals: rows, opportunities: ops, onCreate, onReply, onSync, onConnect, onFeedback, source, syncing, error, lastSync }: { signals: IdeaSignal[]; opportunities: ReplyOpportunity[]; onCreate: (signal:IdeaSignal) => void; onReply:(item:ReplyOpportunity)=>void; onSync:()=>void; onConnect:()=>void; onFeedback:(signal:IdeaSignal,vote:number)=>void; source:"demo"|"live"; syncing:boolean; error:string; lastSync?:string }) {
  return <div className="discover-layout"><section className="source-banner"><div><DataBadge source={source}/><p>{source === "live" ? `Ideas and replies are ranked from your real X feed${lastSync ? ` · synced ${new Date(lastSync).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : ""}.` : "These are examples. Connect X to derive ideas and reply opportunities from accounts you actually follow."}</p></div>{source === "live" ? <button className="outline-btn" onClick={onSync} disabled={syncing}><CircleGauge size={14}/>{syncing ? "Syncing…" : "Sync from X"}</button> : <button className="primary-btn" onClick={onConnect}><Link2 size={14}/> Connect X</button>}</section>{error && <div className="sync-error">Could not sync: {error}</div>}<section className="panel full-panel"><div className="panel-header"><div><span className="eyebrow">IDEAS FROM YOUR NETWORK</span><h2>What is gaining momentum</h2><p>Topics found in your home timeline and compared with your recent posts.</p></div><button className="outline-btn" onClick={source === "live" ? onSync : onConnect}><CircleGauge size={14}/> {source === "live" ? "Refresh ideas" : "Connect for live ideas"}</button></div><div className="signal-cards">{rows.map((signal, index) => <article key={signal.topic}><div className="signal-rank">0{index+1}</div><Flame size={18}/><div><h3>{signal.topic} <small>{signal.pillar}</small></h3><p>{signal.rationale || signal.change}</p></div><div className="idea-vote"><button onClick={()=>onFeedback(signal,1)}>👍</button><button onClick={()=>onFeedback(signal,-1)}>👎</button></div><div className="signal-score"><strong>{signal.score}</strong><span>signal score</span></div><button className="outline-btn" onClick={() => onCreate(signal)}><Lightbulb size={14}/> Use idea</button></article>)}</div></section><section className="panel full-panel"><OpportunityList items={ops} source={source} onReply={onReply} onView={() => {}}/></section></div>;
}

function ScheduleView({ items, onCreate }: { items: ContentItem[]; onCreate: () => void }) {
  const start=new Date();start.setHours(0,0,0,0);const days=Array.from({length:7},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);return date});
  return <section className="panel full-panel calendar-panel"><div className="panel-header"><div><span className="eyebrow">PERSISTENT SCHEDULE</span><h2>Next seven days</h2><p>Scheduled posts are stored in D1 and published by the protected cron endpoint.</p></div><button className="primary-btn" onClick={onCreate}><Plus size={16}/> Schedule post</button></div><div className="calendar-grid">{days.map((day,index)=>{const dayItems=items.filter((item)=>item.date!=="—"&&new Date(item.date).toDateString()===day.toDateString());return <div className="calendar-day" key={day.toISOString()}><strong>{day.toLocaleDateString(undefined,{weekday:"short",day:"numeric"}).toUpperCase()}</strong><span className="best-time"><Clock3 size={12}/> Suggested {index%2?"17:30":"10:00"}</span>{dayItems.map((item)=><article key={item.id}><span>{new Date(item.date).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span><p>{item.text}</p>{item.evergreen&&<small>Evergreen</small>}</article>)}</div>})}</div></section>;
}

function AnalyticsView({ range, setRange, data }: { range: string; setRange: (v: string) => void; data?:AnalyticsData }) {
  if(!data||data.source==="empty")return <section className="panel full-panel empty-analytics"><BarChart3 size={28}/><h2>No live analytics yet</h2><p>Connect X and publish or sync posts. OpenX stores periodic snapshots because private X metrics are time-limited.</p></section>;
  const cards=[{label:"Impressions",value:data.totals.impressions.toLocaleString(),icon:CircleGauge},{label:"Likes",value:data.totals.likes.toLocaleString(),icon:Activity},{label:"Replies",value:data.totals.replies.toLocaleString(),icon:MessageCircle},{label:"Reposts",value:data.totals.reposts.toLocaleString(),icon:TrendingUp}];
  const breakdown=(title:string,rows:AnalyticsData["byTopic"])=><section className="panel analytics-breakdown"><div className="panel-header"><div><span className="eyebrow">CONTENT INTELLIGENCE</span><h2>{title}</h2></div></div>{rows.slice(0,6).map((row)=><div className="breakdown-row" key={row.label}><span>{row.label}</span><i><b style={{width:`${Math.max(8,100*(row.impressions/(rows[0]?.impressions||1)))}%`}}/></i><strong>{row.impressions.toLocaleString()}</strong></div>)}</section>;
  return <div className="analytics-layout"><section className="metrics-row">{cards.map(({label,value,icon:Icon})=><article className="metric-card" key={label}><div><span>{label}</span><strong>{value}</strong><small><Check size={12}/>LIVE<em>from X snapshots</em></small></div><div className="metric-icon"><Icon size={18}/></div></article>)}</section><section className="panel full-panel"><div className="panel-header"><div><span className="eyebrow">PERFORMANCE</span><h2>Growth over time</h2></div><div className="range-tabs">{["7D","28D","90D","1Y"].map((item)=><button className={range===item?"selected":""} key={item} onClick={()=>setRange(item)}>{item}</button>)}</div></div><div className="large-chart"><GrowthChart range={range}/></div></section><div className="analytics-grid">{breakdown("Performance by topic",data.byTopic)}{breakdown("Performance by format",data.byFormat)}{breakdown("Best hooks",data.byHook)}{breakdown("Best posting times",data.byHour)}</div></div>;
}

function SettingsView({ connected, config, csrf, onDisconnected, onOpenGuide }: { connected:boolean;config:AppRuntimeConfig;csrf:string;onDisconnected:()=>void;onOpenGuide:()=>void }) {
  const [message,setMessage]=useState("");
  const callback = typeof window === "undefined" ? "https://your-domain.com/api/auth/x/callback" : `${window.location.origin}/api/auth/x/callback`;
  const disconnect=async()=>{const response=await fetch("/api/x/disconnect",{method:"POST",headers:{"X-CSRF-Token":csrf}});if(response.ok){onDisconnected();setMessage("X disconnected and stored tokens deleted.")}};
  const deleteAll=async()=>{if(!window.confirm("Delete every local draft, schedule, metric, feedback item, cached X post and OAuth token? This cannot be undone."))return;const response=await fetch("/api/data/delete",{method:"DELETE",headers:{"X-CSRF-Token":csrf}});if(response.ok){onDisconnected();setMessage("All local application data was deleted. Refreshing…");setTimeout(()=>window.location.reload(),700)}else setMessage("Deletion failed.")};
  const importData=async(file:File)=>{try{const payload=JSON.parse(await file.text());const response=await fetch("/api/data/import",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify(payload)});const failure=response.ok?undefined:await response.json() as {error?:string};setMessage(response.ok?"Import completed. Refresh to see the data.":`Import failed: ${failure?.error??"unknown error"}`)}catch{setMessage("Invalid JSON export.")}};
  return <div className="settings-layout"><section className="panel settings-card"><div className="panel-header"><div><span className="eyebrow">FORK-FIRST CONFIGURATION</span><h2>X connection</h2><p>Credentials are read only from this deployment&apos;s environment variables. They are never accepted by the browser or committed to Git.</p></div><div className={`connection-state ${connected?"is-connected":""}`}><i/>{connected?"Connected":"Not connected"}</div></div><div className="config-status"><StatusLine ok={config.configured} label="X_CLIENT_ID and SESSION_SECRET"/><StatusLine ok={config.accessProtected} label="APP_ACCESS_TOKEN protection"/><StatusLine ok={config.aiConfigured} label="Optional AI provider"/><StatusLine ok={!config.aiConfigured||config.aiContentApproved} label="AI policy confirmation"/></div><button className="setup-help" onClick={onOpenGuide}><Lightbulb size={16}/><span><strong>Need help configuring your fork?</strong><small>Open the setup guide</small></span><ArrowUpRight size={15}/></button><label className="callback-field">OAuth callback URL<div className="copy-input"><input readOnly value={callback}/><button type="button" onClick={()=>navigator.clipboard.writeText(callback)} aria-label="Copy callback URL"><Link2 size={15}/></button></div></label><div className="settings-actions">{connected?<button className="danger-btn" onClick={disconnect}>Disconnect X and delete tokens</button>:<a className={`primary-btn ${!config.configured?"disabled":""}`} href={config.configured?"/api/x/oauth/start":"#"}><Link2 size={16}/> Continue with X</a>}<a className="outline-btn" href="/api/data/export" download>Export all data</a><label className="outline-btn file-button">Import JSON<input type="file" accept="application/json" onChange={(event)=>{const file=event.target.files?.[0];if(file)void importData(file)}}/></label><button className="danger-btn" onClick={deleteAll}>Delete all local data</button><a className="outline-btn" href="/privacy">Privacy notice</a></div>{message&&<div className="form-disclaimer"><Check size={14}/><span>{message}</span></div>}</section><aside className="panel principle-card"><Code2 size={22}/><h3>Secure by default</h3><p>OAuth tokens are AES-GCM encrypted before D1 storage. Write actions require CSRF protection, scheduled publishing requires CRON_SECRET, and AI actions remain disabled until the operator confirms policy approval for the declared use case.</p><a href="https://github.com/dg996/OpenX-Growth/blob/main/SECURITY.md" target="_blank" rel="noreferrer">Security model <ArrowUpRight size={13}/></a></aside></div>;
}

function StatusLine({ok,label}:{ok:boolean;label:string}){return <div className={ok?"ok":"warning"}>{ok?<Check size={14}/>:<X size={14}/>}<span>{label}</span><b>{ok?"Ready":"Required"}</b></div>}
