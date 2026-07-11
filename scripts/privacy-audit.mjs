import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const textFiles=files.filter((file)=>!/^\.vinext\/fonts\//.test(file)&&!/(?:\.woff2?|\.png|\.jpe?g|\.gif|\.ico|package-lock\.json)$/.test(file));
const checks=[
  ["private key",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token",/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ["OpenAI-style key",/\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key",/\bAKIA[0-9A-Z]{16}\b/],
  ["Sites project identity",/\bappgprj_[a-f0-9]{20,}\b/],
  ["Sites deployment identity",/\bappgdep_[a-f0-9]{20,}\b/],
  ["generated deployment hostname",/\b[a-z0-9-]+\.[a-z0-9-]+\.chatgpt\.site\b/i],
  ["personal email",/\b[A-Z0-9._%+-]+@(?!example\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
];
const findings=[];
for(const file of textFiles){let source;try{source=readFileSync(file,"utf8")}catch{continue}for(const [label,pattern] of checks){const match=source.match(pattern);if(match)findings.push(`${file}: ${label} (${match[0].slice(0,24)}…)`)}}
const env=readFileSync(".env.example","utf8");
for(const line of env.split(/\r?\n/)){if(!line||line.startsWith("#"))continue;const [name,value=""]=line.split("=",2);if(/(?:SECRET|TOKEN|API_KEY)$/.test(name)&&value&&!/^(?:your_|a_|$)/.test(value))findings.push(`.env.example: ${name} must be empty or an obvious placeholder`)}
if(findings.length){console.error("Privacy audit failed:\n"+findings.map((item)=>`- ${item}`).join("\n"));process.exit(1)}
console.log(`Privacy audit passed (${textFiles.length} tracked text files checked).`);
