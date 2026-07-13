export type SnapshotMetrics = {
  postId: string;
  recordedAt: number;
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
};

export type ProvenanceSource="demo"|"live"|"derived"|"estimate";
export type Provenance={source:ProvenanceSource;recordedAt:number};
export type Metric<T>={value:T;provenance:Provenance};
export type AnalyticsRange="7D"|"28D"|"90D"|"1Y";
export type AnalyticsPost={
  id:string;
  text:string;
  xPostId:string|null;
  publishedAt:number|null;
  topic:string|null;
  format:string;
  hook:string|null;
};
export type FollowerSnapshot={accountId:string;recordedAt:number;followers:number};

export const MIN_POSTING_TIME_SAMPLES=8;

const RANGE_DAYS:Record<AnalyticsRange,number>={"7D":7,"28D":28,"90D":90,"1Y":365};
const metric=<T>(value:T,source:ProvenanceSource,recordedAt:number):Metric<T>=>({value,provenance:{source,recordedAt}});
const engagement=(snapshot:SnapshotMetrics)=>snapshot.likes+snapshot.replies+snapshot.reposts;
const hasMeasuredImpressions=(snapshot:SnapshotMetrics)=>snapshot.impressions>0;
const engagementRate=(snapshot:SnapshotMetrics)=>hasMeasuredImpressions(snapshot)?engagement(snapshot)/snapshot.impressions:0;
const comparableEngagements=(snapshots:Iterable<SnapshotMetrics>)=>[...snapshots].reduce((sum,snapshot)=>sum+(hasMeasuredImpressions(snapshot)?engagement(snapshot):0),0);
const median=(values:number[])=>{
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};

export function summarizeLatestSnapshots<T extends SnapshotMetrics>(snapshots: T[]) {
  const latest = new Map<string,T>();

  for (const snapshot of snapshots) {
    const current = latest.get(snapshot.postId);
    if (!current || snapshot.recordedAt > current.recordedAt) latest.set(snapshot.postId,snapshot);
  }

  const totals = [...latest.values()].reduce((sum,snapshot)=>({
    impressions:sum.impressions+snapshot.impressions,
    likes:sum.likes+snapshot.likes,
    replies:sum.replies+snapshot.replies,
    reposts:sum.reposts+snapshot.reposts,
  }),{impressions:0,likes:0,replies:0,reposts:0});

  return {latest,totals};
}

export function buildAnalyticsView(input:{
  now:number;
  range:AnalyticsRange;
  posts:AnalyticsPost[];
  snapshots:SnapshotMetrics[];
  followerSnapshots:FollowerSnapshot[];
}) {
  const startAt=input.now-RANGE_DAYS[input.range]*86_400_000;
  const snapshots=input.snapshots.filter((row)=>row.recordedAt>=startAt&&row.recordedAt<=input.now).sort((a,b)=>a.recordedAt-b.recordedAt||a.postId.localeCompare(b.postId));
  const followerSnapshots=input.followerSnapshots.filter((row)=>row.recordedAt>=startAt&&row.recordedAt<=input.now).sort((a,b)=>a.recordedAt-b.recordedAt);
  const observedAt=Math.max(0,...snapshots.map((row)=>row.recordedAt),...followerSnapshots.map((row)=>row.recordedAt));
  const {latest,totals}=summarizeLatestSnapshots(snapshots);
  const totalEngagements=totals.likes+totals.replies+totals.reposts;
  const measuredEngagements=comparableEngagements(latest.values());

  const series=[...new Set(snapshots.map((row)=>row.recordedAt))].map((recordedAt)=>{
    const {latest:pointLatest,totals:point}=summarizeLatestSnapshots(snapshots.filter((row)=>row.recordedAt<=recordedAt));
    const pointEngagements=point.likes+point.replies+point.reposts;
    const pointMeasuredEngagements=comparableEngagements(pointLatest.values());
    return {
      recordedAt,
      impressions:metric(point.impressions,"derived",recordedAt),
      engagements:metric(pointEngagements,"derived",recordedAt),
      engagementRate:metric(pointMeasuredEngagements/Math.max(1,point.impressions),"derived",recordedAt),
    };
  });

  const linked=input.posts.flatMap((post)=>{
    const snapshot=post.xPostId?latest.get(post.xPostId):undefined;
    return snapshot&&post.publishedAt?[{post,snapshot}]:[];
  });
  const group=(key:(post:AnalyticsPost)=>string)=>Object.values(linked.reduce<Record<string,{label:string;posts:number;impressions:number;engagements:number;rates:number[];recordedAt:number}>>((map,row)=>{
    const label=key(row.post)||"Uncategorized";
    const item=map[label]??={label,posts:0,impressions:0,engagements:0,rates:[],recordedAt:0};
    item.posts++;
    item.impressions+=row.snapshot.impressions;
    item.engagements+=engagement(row.snapshot);
    if(hasMeasuredImpressions(row.snapshot))item.rates.push(engagementRate(row.snapshot));
    item.recordedAt=Math.max(item.recordedAt,row.snapshot.recordedAt);
    return map;
  },{})).map(({rates,recordedAt,...row})=>({
    ...row,
    medianEngagementRate:metric(median(rates),"derived",recordedAt),
    provenance:{source:"derived" as const,recordedAt},
  })).sort((a,b)=>b.medianEngagementRate.value-a.medianEngagementRate.value||b.posts-a.posts||a.label.localeCompare(b.label));

  const comparableLinked=linked.filter((row)=>hasMeasuredImpressions(row.snapshot));
  const hourGroups=comparableLinked.reduce<Map<number,Array<{snapshot:SnapshotMetrics}>>>((map,row)=>{
    const hour=new Date(row.post.publishedAt!).getUTCHours();
    const values=map.get(hour)??[];
    values.push({snapshot:row.snapshot});
    map.set(hour,values);
    return map;
  },new Map());
  const postingSuggestions=[...hourGroups.entries()].filter(([,rows])=>rows.length>=2).map(([hour,rows])=>{
    const suggestionObservedAt=Math.max(...rows.map((row)=>row.snapshot.recordedAt));
    return {
      hour,
      label:`${hour.toString().padStart(2,"0")}:00 UTC`,
      sampleSize:rows.length,
      medianEngagementRate:median(rows.map((row)=>engagementRate(row.snapshot))),
      provenance:{source:"derived" as const,recordedAt:suggestionObservedAt},
    };
  }).sort((a,b)=>b.medianEngagementRate-a.medianEngagementRate||b.sampleSize-a.sampleSize||a.hour-b.hour);

  return {
    range:{key:input.range,startAt,endAt:input.now},
    dataStatus:snapshots.length||followerSnapshots.length?"available" as const:"insufficient_data" as const,
    raw:{
      postSnapshots:snapshots.map((row)=>({...row,provenance:{source:"live" as const,recordedAt:row.recordedAt}})),
      followerSnapshots:followerSnapshots.map((row)=>({...row,provenance:{source:"live" as const,recordedAt:row.recordedAt}})),
    },
    derived:{
      totals:{
        impressions:metric(totals.impressions,"derived",observedAt||input.now),
        likes:metric(totals.likes,"derived",observedAt||input.now),
        replies:metric(totals.replies,"derived",observedAt||input.now),
        reposts:metric(totals.reposts,"derived",observedAt||input.now),
        engagements:metric(totalEngagements,"derived",observedAt||input.now),
        engagementRate:metric(measuredEngagements/Math.max(1,totals.impressions),"derived",observedAt||input.now),
      },
      series,
      byTopic:group((post)=>post.topic??"Uncategorized"),
      byFormat:group((post)=>post.format),
      byHook:group((post)=>(post.hook??post.text).split(/\s+/).slice(0,5).join(" ")),
      byHour:group((post)=>post.publishedAt?`${new Date(post.publishedAt).getUTCHours().toString().padStart(2,"0")}:00 UTC`:"Unscheduled"),
    },
    followers:{
      status:followerSnapshots.length>=2?"ready" as const:"insufficient_data" as const,
      minimumSamples:2,
      series:followerSnapshots.map((row)=>({recordedAt:row.recordedAt,followers:metric(row.followers,"live",row.recordedAt)})),
    },
    postingTimes:{
      status:comparableLinked.length>=MIN_POSTING_TIME_SAMPLES?"ready" as const:"insufficient_data" as const,
      minimumSamples:MIN_POSTING_TIME_SAMPLES,
      sampleSize:comparableLinked.length,
      method:"median engagement rate by UTC hour for posts with measured impressions; minimum two posts per suggested hour",
      suggestions:comparableLinked.length>=MIN_POSTING_TIME_SAMPLES?postingSuggestions:[],
    },
  };
}
