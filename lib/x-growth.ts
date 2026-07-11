export type XPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; impression_count?: number };
};

export type XUser = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  public_metrics?: { followers_count?: number };
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
};

export type IdeaSignal = {
  topic: string;
  change: string;
  score: number;
  bars: number[];
  hook: string;
  rationale: string;
  pillar: string;
};

const stopwords = new Set(["about","after","again","also","been","being","build","could","does","from","have","into","just","more","most","only","over","really","should","some","than","that","their","there","these","they","this","through","what","when","where","which","while","with","would","your","you're","https"]);

const compactNumber = (value: number) => value >= 1_000_000 ? `${(value/1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value/1_000)}K` : `${value}`;

export function rankReplyOpportunities(posts: XPost[], users: XUser[]): ReplyOpportunity[] {
  const userMap = new Map(users.map((user) => [user.id, user]));
  return posts.map((post) => {
    const author = userMap.get(post.author_id ?? "");
    const metrics = post.public_metrics ?? {};
    const followers = author?.public_metrics?.followers_count ?? 0;
    const engagement = (metrics.like_count ?? 0) + (metrics.retweet_count ?? 0) * 2 + (metrics.reply_count ?? 0) * 1.5;
    const ageHours = post.created_at ? Math.max(1,(Date.now() - new Date(post.created_at).getTime()) / 3_600_000) : 12;
    const velocity = engagement / ageHours;
    const relevance = Math.max(51,Math.min(98,Math.round(58 + Math.log10(velocity + 1) * 12 + Math.log10(followers + 10) * 4)));
    return {
      id: post.id,
      initials: (author?.name ?? "X User").split(" ").map((part) => part[0]).join("").slice(0,2).toUpperCase(),
      name: author?.name ?? "X user",
      handle: author ? `@${author.username}` : "@unknown",
      post: post.text,
      reach: compactNumber(metrics.impression_count ?? followers),
      relevance,
      url: author ? `https://x.com/${author.username}/status/${post.id}` : `https://x.com/i/status/${post.id}`,
      suggestedReply: "",
      reason: `${ageHours < 6 ? "Fresh conversation" : "Relevant conversation"} · ${compactNumber(followers)} followers · strong engagement velocity`,
    };
  }).sort((a,b) => b.relevance - a.relevance).slice(0,12);
}

export function generateIdeas(feedPosts: XPost[], ownPosts: XPost[]): IdeaSignal[] {
  const counts = new Map<string,number>();
  for (const post of feedPosts) {
    const words = post.text.toLowerCase().replace(/https?:\/\/\S+/g,"").match(/[a-z][a-z-]{3,}/g) ?? [];
    for (const word of new Set(words)) if (!stopwords.has(word)) counts.set(word,(counts.get(word) ?? 0)+1);
  }
  const ownText = ownPosts.map((post) => post.text.toLowerCase()).join(" ");
  const topics = [...counts.entries()].filter(([word]) => !ownText.includes(word) || (counts.get(word) ?? 0) > 2).sort((a,b) => b[1]-a[1]).slice(0,5);
  return topics.map(([topic,count],index) => {
    const score = Math.max(52,Math.min(96,90-index*8+count));
    return {
      topic: topic.replace(/\b\w/g,(letter) => letter.toUpperCase()),
      change: `Appeared in ${count} posts from your feed`,
      score,
      bars: Array.from({length:13},(_,bar) => 3 + ((bar * (index+3) + count * 2) % 15)),
      hook: `Everyone is talking about ${topic}. Here is the part most people are missing:`,
      rationale: ownText.includes(topic) ? "A recurring topic in your network that already fits your voice." : "Trending in your network, but missing from your recent posts.",
      pillar: index % 3 === 0 ? "Industry insight" : index % 3 === 1 ? "Build in public" : "Founder lesson",
    };
  });
}
