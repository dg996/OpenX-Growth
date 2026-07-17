export type CanonicalOriginStatus={configured:boolean;valid:boolean;canonicalOrigin?:string;currentMatchesCanonical:boolean};

export function safeOriginDiagnostic(value:string) {
  try{
    const parsed=new URL(value);
    if(parsed.hostname==="localhost"||parsed.hostname==="127.0.0.1")return parsed.origin;
    return `${parsed.protocol}//[non-loopback]`;
  }catch{return "[invalid]";}
}

export function canonicalOriginStatus(appUrl:string,currentOrigin:string):CanonicalOriginStatus {
  if(!appUrl)return {configured:false,valid:false,currentMatchesCanonical:false};
  try{
    const parsed=new URL(appUrl);
    const valid=(parsed.protocol==="http:"||parsed.protocol==="https:")&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&(parsed.pathname===""||parsed.pathname==="/");
    if(!valid)return {configured:true,valid:false,currentMatchesCanonical:false};
    return {configured:true,valid:true,canonicalOrigin:parsed.origin,currentMatchesCanonical:parsed.origin===currentOrigin};
  }catch{return {configured:true,valid:false,currentMatchesCanonical:false};}
}
