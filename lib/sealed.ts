import { appConfig } from "./config.ts";

const encode = (bytes:Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
const decode = (value:string) => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=")),(char)=>char.charCodeAt(0));

async function key() {
  const secret=appConfig().sessionSecret;
  if(secret.length<32)throw new Error("SESSION_SECRET must be at least 32 characters");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}

export async function seal(value:unknown):Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},await key(),new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function unseal<T>(value?:string):Promise<T|null> {
  if(!value)return null;
  try{
    const [iv,data]=value.split(".");
    const decrypted=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(iv)},await key(),decode(data));
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  }catch{return null;}
}
