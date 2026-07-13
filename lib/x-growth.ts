export const ALGORITHM_VERSION="openx-rank-2026-07-v1";

export type XPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  referenced_tweets?: Array<{type:string;id?:string}>;
  public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; impression_count?: number };
};

export type XUser = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  public_metrics?: { followers_count?: number };
};

export type RankingFeedback={
  targetType:"idea"|"reply";
  targetId:string;
  vote:1|-1;
  context?:unknown;
  createdAt:number;
};

export type RankingOptions={
  clock?:()=>number;
  ownPosts?:XPost[];
  feedback?:RankingFeedback[];
  limit?:number;
};

export type ReplyFeatures={
  freshness:number;
  topicalAffinity:number;
  authorReach:number;
  engagementVelocity:number;
  feedback:number;
  duplicatePenalty:number;
  isReply:boolean;
  missingMetrics:boolean;
  topics:string[];
  cluster:string;
};

export type ReplyOpportunity = {
  id: string;
  initials: string;
  name: string;
  handle: string;
  post: string;
  reach: string;
  relevance: number;
  url: string;
  suggestedReply: string;
  reason: string;
  reachProvenance: {source:"demo"|"live"|"estimate";recordedAt:number};
  relevanceProvenance: {source:"demo"|"derived";recordedAt:number};
  algorithmVersion?:string;
  featureExplanation?:ReplyFeatures;
};

export type IdeaFeatures={frequency:number;novelty:number;feedback:number;cluster:string;phrases:string[]};

export type IdeaSignal = {
  topic: string;
  change: string;
  score: number;
  bars?: number[];
  hook: string;
  rationale: string;
  pillar: string;
  scoreProvenance: {source:"demo"|"derived";recordedAt:number};
  algorithmVersion?:string;
  featureExplanation?:IdeaFeatures;
};

const EN_STOPWORDS=["a","about","after","again","all","also","am","an","and","are","as","at","be","been","being","build","building","built","but","by","can","could","did","do","does","even","for","from","get","good","got","has","have","he","her","here","him","his","how","i","if","in","into","is","it","its","just","know","like","made","make","me","more","most","much","my","need","new","no","not","now","of","on","one","only","or","our","over","people","post","really","rt","should","so","some","still","than","that","the","their","them","then","there","these","they","thing","things","this","thread","through","time","to","today","too","up","us","use","used","uses","using","very","want","was","we","well","what","when","where","which","while","who","will","with","without","work","would","you","your","you're"];
const IT_STOPWORDS=["a","ad","ai","al","agli","alla","alle","allo","anche","che","chi","ci","come","con","da","dai","dal","dalla","dalle","dei","del","della","delle","dello","di","e","ed","è","era","essere","gli","ha","hai","hanno","ho","i","il","in","io","la","le","lo","loro","ma","mi","nei","nel","nella","nelle","noi","non","nuova","nuovo","o","per","perché","più","post","quale","questa","questo","se","senza","si","sono","sta","stato","su","sua","sue","suo","suoi","ti","tra","tu","un","una","uno","usa","usare","uso","vi","voi"];
const STOPWORDS=new Set([...EN_STOPWORDS,...IT_STOPWORDS,"http","https","x","com"]);
const ACRONYM_LABELS=new Map([["ai","AI"],["api","API"],["d1","D1"],["llm","LLM"],["mcp","MCP"],["saas","SaaS"]]);

const clamp=(value:number,minimum:number,maximum:number)=>Math.min(maximum,Math.max(minimum,value));
const compactNumber = (value: number) => value >= 1_000_000 ? `${(value/1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value/1_000)}K` : `${value}`;
export function tokenizeText(value:string) {
  const rawTokens=value.normalize("NFKC").replace(/https?:\/\/\S+/gu," ").replace(/[’']/gu," ").match(/[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*/gu)??[];
  return rawTokens.flatMap((raw)=>{
    const token=raw.toLocaleLowerCase("it");
    const recognizedAcronym=raw.length>1&&raw===raw.toLocaleUpperCase("it")&&ACRONYM_LABELS.has(token);
    return token.length>1&&(!STOPWORDS.has(token)||recognizedAcronym)?[token]:[];
  });
}

export function filterNetworkPosts(posts:XPost[],connectedAccountId:string) {
  return posts.filter((post)=>post.author_id!==connectedAccountId);
}

function phraseCounts(texts:string[]) {
  const counts=new Map<string,number>();
  for(const text of texts){
    const tokens=tokenizeText(text);
    for(const token of new Set(tokens))counts.set(token,(counts.get(token)??0)+1);
    for(let index=0;index<tokens.length-1;index++){
      const phrase=`${tokens[index]} ${tokens[index+1]}`;
      counts.set(phrase,(counts.get(phrase)??0)+1);
    }
  }
  return counts;
}

export function extractTopicPhrases(value:string) {
  const counts=phraseCounts(value.split(/[.!?\n]+/u));
  return [...counts.entries()].filter(([phrase,count])=>phrase.includes(" ")?count>=2:count>=1).sort((a,b)=>b[1]-a[1]||b[0].split(" ").length-a[0].split(" ").length||a[0].localeCompare(b[0],"it")).map(([phrase])=>phrase);
}

function similarity(left:string[],right:string[]) {
  const a=new Set(left),b=new Set(right);
  const intersection=[...a].filter((token)=>b.has(token)).length;
  return intersection/Math.max(1,a.size+b.size-intersection);
}

function feedbackStrings(feedback:RankingFeedback) {
  const values=[feedback.targetId];
  if(feedback.context&&typeof feedback.context==="object"){
    for(const key of ["topic","post","handle","name","author"]){
      const value=(feedback.context as Record<string,unknown>)[key];
      if(typeof value==="string")values.push(value);
    }
  }
  return values;
}

function feedbackModel(rows:RankingFeedback[]) {
  const tokens=new Map<string,number>(),targets=new Map<string,number>(),authors=new Map<string,number>();
  for(const row of [...rows].sort((a,b)=>a.createdAt-b.createdAt||a.targetId.localeCompare(b.targetId))){
    targets.set(row.targetId,clamp((targets.get(row.targetId)??0)+row.vote,-2,2));
    const context=row.context&&typeof row.context==="object"?row.context as Record<string,unknown>:{};
    const handle=typeof context.handle==="string"?context.handle.toLocaleLowerCase("it"):undefined;
    if(handle)authors.set(handle,clamp((authors.get(handle)??0)+row.vote,-2,2));
    for(const token of new Set(feedbackStrings(row).flatMap(tokenizeText)))tokens.set(token,clamp((tokens.get(token)??0)+row.vote,-2,2));
  }
  return {tokens,targets,authors};
}

function preferenceFor(tokens:string[],targetId:string,handle:string,model:ReturnType<typeof feedbackModel>) {
  const tokenSignal=tokens.reduce((sum,token)=>sum+(model.tokens.get(token)??0),0)/Math.max(1,Math.sqrt(tokens.length));
  return clamp(tokenSignal*4+(model.targets.get(targetId)??0)*6+(model.authors.get(handle.toLocaleLowerCase("it"))??0)*3,-12,12);
}

function resolveOptions(options?:RankingOptions|number):Required<Pick<RankingOptions,"clock"|"ownPosts"|"feedback"|"limit">> {
  if(typeof options==="number")return {clock:()=>options,ownPosts:[],feedback:[],limit:12};
  return {clock:options?.clock??Date.now,ownPosts:options?.ownPosts??[],feedback:options?.feedback??[],limit:options?.limit??12};
}

function materialReason(features:ReplyFeatures) {
  const reasons:Array<[number,string]>=[
    [features.topicalAffinity,"topical affinity"],
    [features.freshness,"freshness"],
    [features.engagementVelocity,"engagement velocity"],
    [Math.abs(features.feedback)/12,features.feedback>=0?"positive feedback preference":"negative feedback preference"],
    [features.authorReach,"author reach"],
  ];
  const material=reasons.filter(([value])=>value>=0.12).sort((a,b)=>b[0]-a[0]).slice(0,3).map(([,label])=>label);
  if(features.isReply)material.push("reply penalty");
  if(features.missingMetrics)material.push("missing metrics");
  return material.join(" · ")||"limited ranking evidence";
}

export function rankReplyOpportunities(posts:XPost[],users:XUser[],options?:RankingOptions|number):ReplyOpportunity[] {
  const resolved=resolveOptions(options),now=resolved.clock(),userMap=new Map(users.map((user)=>[user.id,user]));
  const ownTokenSets=resolved.ownPosts.map((post)=>tokenizeText(post.text));
  const preferences=feedbackModel(resolved.feedback.filter((row)=>row.createdAt>=now-90*86_400_000&&row.createdAt<=now));
  const candidates=posts.map((post)=>{
    const author=userMap.get(post.author_id??""),metrics=post.public_metrics??{},tokens=tokenizeText(post.text);
    const followers=author?.public_metrics?.followers_count??0;
    const ageMs=post.created_at?now-new Date(post.created_at).getTime():12*3_600_000;
    const ageHours=Number.isFinite(ageMs)?Math.max(0,ageMs/3_600_000):168;
    const freshness=clamp(1-ageHours/168,0,1);
    const topicalAffinity=ownTokenSets.length?Math.max(...ownTokenSets.map((own)=>similarity(tokens,own))):0;
    const engagement=(metrics.like_count??0)+(metrics.retweet_count??0)*2+(metrics.reply_count??0)*1.5;
    const engagementVelocity=clamp(Math.log1p(engagement/Math.max(1,ageHours))/5,0,1);
    const authorReach=clamp(Math.log10(followers+1)/5,0,1);
    const isReply=post.referenced_tweets?.some((reference)=>reference.type==="replied_to")??false;
    const missingMetrics=metrics.like_count===undefined&&metrics.retweet_count===undefined&&metrics.reply_count===undefined&&metrics.impression_count===undefined;
    const handle=author?`@${author.username}`:"@unknown";
    const feedback=preferenceFor(tokens,post.id,handle,preferences);
    const phrases=extractTopicPhrases(post.text),cluster=(phrases.find((phrase)=>phrase.includes(" "))??tokens.slice(0,2).join(" ")??post.id)||post.id;
    const featureExplanation:ReplyFeatures={freshness,topicalAffinity,authorReach,engagementVelocity,feedback,duplicatePenalty:0,isReply,missingMetrics,topics:phrases.slice(0,4),cluster};
    const rawScore=35+freshness*20+topicalAffinity*28+authorReach*8+engagementVelocity*12+feedback-(isReply?12:0)-(missingMetrics?6:0);
    return {
      id:post.id,
      initials:(author?.name??"X User").split(" ").map((part)=>part[0]).join("").slice(0,2).toUpperCase(),
      name:author?.name??"X user",
      handle,
      post:post.text,
      reach:compactNumber(metrics.impression_count??followers),
      relevance:Math.round(clamp(rawScore,0,100)),
      url:author?`https://x.com/${author.username}/status/${post.id}`:`https://x.com/i/status/${post.id}`,
      suggestedReply:"",
      reason:materialReason(featureExplanation),
      reachProvenance:{source:metrics.impression_count===undefined?"estimate" as const:"live" as const,recordedAt:now},
      relevanceProvenance:{source:"derived" as const,recordedAt:now},
      algorithmVersion:ALGORITHM_VERSION,
      featureExplanation,
      _tokens:tokens,
    };
  }).sort((a,b)=>b.relevance-a.relevance||a.id.localeCompare(b.id));

  const selected:typeof candidates=[];
  for(const candidate of candidates){
    const duplicate=selected.some((row)=>row.handle===candidate.handle||similarity(row._tokens,candidate._tokens)>=0.65);
    if(duplicate)continue;
    selected.push(candidate);
    if(selected.length>=resolved.limit)break;
  }
  if(selected.length<resolved.limit){
    for(const candidate of candidates){
      if(selected.includes(candidate))continue;
      candidate.featureExplanation.duplicatePenalty=-8;
      candidate.relevance=Math.max(0,candidate.relevance-8);
      candidate.reason=`${candidate.reason} · diversity penalty`;
      selected.push(candidate);
      if(selected.length>=resolved.limit)break;
    }
  }
  return selected.map((candidate)=>Object.fromEntries(Object.entries(candidate).filter(([key])=>key!=="_tokens")) as ReplyOpportunity);
}

const title=(value:string)=>value.split(" ").map((token,index)=>ACRONYM_LABELS.get(token)??(index===0?token.charAt(0).toLocaleUpperCase("it")+token.slice(1):token)).join(" ");
const pillarFor=(topic:string)=>["Industry insight","Build in public","Founder lesson"][[...topic].reduce((sum,char)=>sum+char.codePointAt(0)!,0)%3];

export function generateIdeas(feedPosts:XPost[],ownPosts:XPost[],options?:RankingOptions|number):IdeaSignal[] {
  const resolved=resolveOptions(options),now=resolved.clock(),counts=phraseCounts(feedPosts.map((post)=>post.text));
  const preferences=feedbackModel(resolved.feedback.filter((row)=>row.createdAt>=now-90*86_400_000&&row.createdAt<=now)),ownTokenSets=ownPosts.map((post)=>tokenizeText(post.text));
  const candidates=[...counts.entries()].filter(([phrase,count])=>phrase.includes(" ")?count>=2:count>=2).map(([phrase,count])=>{
    const tokens=tokenizeText(phrase);
    const novelty=ownTokenSets.length?1-Math.max(...ownTokenSets.map((own)=>similarity(tokens,own))):1;
    const feedback=preferenceFor(tokens,phrase,"",preferences);
    const score=Math.round(clamp(40+Math.min(4,count)*8+novelty*20+feedback,0,100));
    const cluster=tokens.slice(0,2).join(" ")||phrase;
    return {phrase,count,novelty,feedback,score,cluster,tokens};
  }).sort((a,b)=>b.score-a.score||b.tokens.length-a.tokens.length||a.phrase.localeCompare(b.phrase,"it"));

  const selected:typeof candidates=[];
  for(const candidate of candidates){
    if(selected.some((row)=>similarity(row.tokens,candidate.tokens)>=0.6))continue;
    selected.push(candidate);
    if(selected.length>=5)break;
  }
  return selected.map((candidate)=>({
    topic:title(candidate.phrase),
    change:`Appeared in ${candidate.count} posts from your feed`,
    score:candidate.score,
    hook:`A useful angle on ${candidate.phrase}:`,
    rationale:`${candidate.novelty>=0.7?"Novel relative to your recent posts":"Related to your recent themes"} · frequency ${candidate.count}${candidate.feedback?` · feedback ${candidate.feedback>0?"+":""}${candidate.feedback.toFixed(1)}`:""}.`,
    pillar:pillarFor(candidate.phrase),
    scoreProvenance:{source:"derived",recordedAt:now},
    algorithmVersion:ALGORITHM_VERSION,
    featureExplanation:{frequency:candidate.count,novelty:candidate.novelty,feedback:candidate.feedback,cluster:candidate.cluster,phrases:[candidate.phrase]},
  }));
}
