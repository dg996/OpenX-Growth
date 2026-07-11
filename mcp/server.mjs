#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const baseUrl=(process.env.OPENX_BASE_URL??"").replace(/\/$/,"");
const token=process.env.OPENX_API_TOKEN??"";
if(!baseUrl||!token)throw new Error("OPENX_BASE_URL and OPENX_API_TOKEN are required");

async function api(path,options={}){const response=await fetch(`${baseUrl}${path}`,{...options,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(options.headers??{})}});const payload=await response.json();if(!response.ok)throw new Error(payload.error??`HTTP ${response.status}`);return payload}
const result=(value)=>({content:[{type:"text",text:JSON.stringify(value,null,2)}]});
const server=new McpServer({name:"openx-growth",version:"0.1.0"});

server.registerTool("list_content",{description:"List drafts, scheduled posts and published content from this OpenX instance",inputSchema:{status:z.enum(["all","draft","scheduled","published","failed"]).default("all")}},async({status})=>{const payload=await api("/api/posts");return result({posts:status==="all"?payload.posts:payload.posts.filter((post)=>post.status===status)})});
server.registerTool("create_draft",{description:"Create a human-reviewable X draft or thread. This never publishes automatically.",inputSchema:{parts:z.array(z.string().max(280)).min(1).max(25),topic:z.string().optional(),evergreen:z.boolean().default(false)}},async({parts,topic,evergreen})=>result(await api("/api/posts",{method:"POST",body:JSON.stringify({text:parts[0],thread:parts,topic,evergreen})})));
server.registerTool("schedule_content",{description:"Create a scheduled post or thread for the protected OpenX scheduler",inputSchema:{parts:z.array(z.string().max(280)).min(1).max(25),scheduledAt:z.string().datetime(),topic:z.string().optional(),evergreen:z.boolean().default(false),evergreenIntervalDays:z.number().int().min(7).default(30)}},async({parts,scheduledAt,topic,evergreen,evergreenIntervalDays})=>result(await api("/api/posts",{method:"POST",body:JSON.stringify({text:parts[0],thread:parts,scheduledAt:new Date(scheduledAt).getTime(),topic,evergreen,evergreenIntervalDays})})));
server.registerTool("sync_x_intelligence",{description:"Refresh reply opportunities and content ideas from the connected X home timeline",inputSchema:{force:z.boolean().default(false)}},async({force})=>result(await api(`/api/x/sync${force?"?force=1":""}`)));
server.registerTool("get_growth_analytics",{description:"Read aggregated X analytics snapshots by topic, format, hook and posting hour",inputSchema:{}},async()=>result(await api("/api/analytics")));

await server.connect(new StdioServerTransport());
