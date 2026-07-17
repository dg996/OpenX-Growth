import worker from "../../worker/index";
import type { XTransport, XTransportRequest, XTransportResult } from "../../lib/x-transport";

const ok=<T>(data:T):XTransportResult<T>=>({ok:true,status:200,data,rateLimit:{limit:100,remaining:99,resetAt:2_000_000_000}});

let publishedCounter=0;

function fixtureTransport(providerStatus:number|undefined,syncStatus:number|undefined,options:{identityId?:string;delayMs?:number;tokenStatus?:number;sparse?:boolean;calls:string[]}):XTransport{return {
  async request<T>(input:XTransportRequest):Promise<XTransportResult<T>> {
    options.calls.push(input.path);
    if(options.delayMs)await new Promise((resolve)=>setTimeout(resolve,options.delayMs));
    if(input.path==="/2/oauth2/token"){if(options.tokenStatus)return {ok:false,status:options.tokenStatus,data:{error:"FIXTURE_PRIVATE_TOKEN_FAILURE"} as T,rateLimit:{}};return ok({access_token:"fixture-refreshed-access-token",refresh_token:"fixture-refreshed-refresh-token",expires_in:7200}) as XTransportResult<T>;}
    if(syncStatus&&input.path.startsWith("/2/users/me"))return {ok:false,status:syncStatus,data:{error:"FIXTURE_SYNC_FAILURE"} as T,rateLimit:{limit:100,remaining:98,resetAt:2_000_000_000}};
    if(input.path.startsWith("/2/users/me")){const id=options.identityId??"owner";return ok({data:{id,name:"Fixture Owner",username:"fixture_owner",public_metrics:{followers_count:125}}}) as XTransportResult<T>;}
    if(input.path.includes("/timelines/reverse_chronological"))return ok(options.sparse?{data:[],includes:{users:[]}}:{
      data:[
        {id:"feed-owner",author_id:"owner",text:"Owner-only private product vocabulary",created_at:"2026-07-13T08:30:00.000Z",public_metrics:{like_count:2,retweet_count:0,reply_count:0,impression_count:50}},
        {id:"feed-1",author_id:"u1",text:"Agentic product evaluation in Italian teams",created_at:"2026-07-13T08:00:00.000Z",public_metrics:{like_count:20,retweet_count:2,reply_count:3,impression_count:500}},
        {id:"feed-3",author_id:"u3",text:"Agentic product evaluation gives startup teams a better feedback loop",created_at:"2026-07-13T06:30:00.000Z",public_metrics:{like_count:12,retweet_count:1,reply_count:1,impression_count:250}},
      ],
      includes:{users:[
        {id:"u1",name:"Fixture Builder",username:"fixture_builder",public_metrics:{followers_count:1_000}},
        {id:"u2",name:"Fixture Founder",username:"fixture_founder",public_metrics:{followers_count:800}},
        {id:"u3",name:"Fixture Operator",username:"fixture_operator",public_metrics:{followers_count:600}},
      ]},
    }) as XTransportResult<T>;
    if(input.path.includes("/2/users/owner/tweets"))return ok({data:options.sparse?[]:[
      {id:"own-1",text:"Existing product note",created_at:"2026-07-12T09:00:00.000Z",public_metrics:{like_count:5,retweet_count:1,reply_count:1,impression_count:100}},
      {id:"own-2",text:"Existing founder note",created_at:"2026-07-11T10:00:00.000Z",public_metrics:{like_count:8,retweet_count:1,reply_count:2,impression_count:150}},
    ]}) as XTransportResult<T>;
    if(input.path==="/2/tweets"&&input.method==="POST"){
      if(providerStatus&&providerStatus!==200)return {ok:false,status:providerStatus,data:{error:"FIXTURE_PROVIDER_FAILURE"} as T,rateLimit:{limit:100,remaining:98,resetAt:2_000_000_000}};
      publishedCounter+=1;return ok({data:{id:`fixture-published-${publishedCounter}`}}) as XTransportResult<T>;
    }
    return {ok:false,status:404,data:{error:"UNKNOWN_X_FIXTURE_PATH"} as T,rateLimit:{}};
  },
};}

const e2eWorker={
  fetch(request:Request,env:Record<string,unknown>,ctx:ExecutionContext) {
    const fault=request.headers.get("x-openx-e2e-publish-fault")??undefined;
    const rawNow=request.headers.get("x-openx-e2e-publish-now");
    const rawStatus=request.headers.get("x-openx-e2e-provider-status");
    const rawSyncStatus=request.headers.get("x-openx-e2e-sync-status");
    const rawDelay=request.headers.get("x-openx-e2e-sync-delay-ms");
    const rawTokenStatus=request.headers.get("x-openx-e2e-token-status");
    const identityId=request.headers.get("x-openx-e2e-account-id")??undefined;
    const publishNow=rawNow===null?undefined:Number(rawNow);
    const providerStatus=rawStatus===null?undefined:Number(rawStatus);
    const syncStatus=rawSyncStatus===null?undefined:Number(rawSyncStatus);
    const envSyncStatus=Number(env.OPENX_E2E_SYNC_STATUS);
    const envDelayMs=Number(env.OPENX_E2E_SYNC_DELAY_MS);
    const envTokenStatus=Number(env.OPENX_E2E_TOKEN_STATUS);
    const delayMs=rawDelay===null?envDelayMs:Number(rawDelay);
    const tokenStatus=rawTokenStatus===null?envTokenStatus:Number(rawTokenStatus);
    const calls:string[]=[];
    const injected=env.OPENX_E2E_X_FIXTURE==="sync"?{
      ...env,
      X_TRANSPORT:fixtureTransport(Number.isFinite(providerStatus)?providerStatus:undefined,Number.isFinite(syncStatus)?syncStatus:Number.isFinite(envSyncStatus)?envSyncStatus:undefined,{identityId,delayMs:Number.isFinite(delayMs)&&delayMs>0?delayMs:undefined,tokenStatus:Number.isFinite(tokenStatus)&&tokenStatus>0?tokenStatus:undefined,sparse:env.OPENX_E2E_SYNC_SPARSE==="1",calls}),
      ...(fault?{PUBLISH_FAULT:fault}:{}),
      ...(Number.isFinite(publishNow)?{PUBLISH_NOW:publishNow}:{}),
    }:env;
    return Promise.resolve(worker.fetch(request,injected as never,ctx as never)).then((response)=>{const headers=new Headers(response.headers);headers.set("x-openx-e2e-x-call-count",String(calls.length));headers.set("x-openx-e2e-x-call-kinds",calls.map((path)=>path.includes("timelines")?"timeline":path.includes("/tweets")?"posts":path.includes("oauth2/token")?"token":"identity").join(","));return new Response(response.body,{status:response.status,statusText:response.statusText,headers});});
  },
};

export default e2eWorker;
