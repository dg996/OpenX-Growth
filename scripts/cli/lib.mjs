import { randomBytes as nodeRandomBytes } from "node:crypto";

export const REQUIRED_SECRET_BYTES = Object.freeze({
  SESSION_SECRET: 48,
  APP_ACCESS_TOKEN: 32,
  CRON_SECRET: 32,
  OPENX_API_TOKEN: 32,
});

export const SETUP_STEPS = Object.freeze([
  { id: "preflight", number: 1, label: "Preflight" },
  { id: "cloudflare", number: 2, label: "Cloudflare login" },
  { id: "database", number: 3, label: "D1 database" },
  { id: "migrations", number: 4, label: "Database migrations" },
  { id: "deploy", number: 5, label: "Build and deploy" },
  { id: "secrets", number: 6, label: "Secrets" },
  { id: "xApplication", number: 7, label: "X application" },
  { id: "healthcheck", number: 8, label: "Healthcheck" },
]);

const D1_ID_PATTERN = /^(?:[a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[1-5a-f\d][a-f\d]{3}-[89ab\d][a-f\d]{3}-[a-f\d]{12})$/i;
const D1_PLACEHOLDER_IDS = new Set([
  "00000000000000000000000000000000",
  "00000000-0000-4000-8000-000000000000",
]);

export function isValidD1DatabaseId(value) {
  if (typeof value !== "string") return false;
  const candidate = value.trim().toLowerCase();
  return D1_ID_PATTERN.test(candidate) && !D1_PLACEHOLDER_IDS.has(candidate);
}

export function generateSecretMaterial(randomBytes = nodeRandomBytes) {
  const values = {};
  for (const name of Object.keys(REQUIRED_SECRET_BYTES)) {
    values[name] = generateSecretValue(name, randomBytes);
  }
  return values;
}

export function generateSecretValue(name, randomBytes = nodeRandomBytes) {
  const bytes = REQUIRED_SECRET_BYTES[name];
  if (!bytes) throw new Error(`Unknown generated secret: ${name}`);
  const generated = randomBytes(bytes);
  if (!generated || generated.length !== bytes) {
    throw new Error(`Secret generator returned ${generated?.length ?? 0} bytes for ${name}; expected ${bytes}`);
  }
  return Buffer.from(generated).toString("base64");
}

function extractJson(source) {
  const text = String(source ?? "").trim();
  if (!text) throw new Error("Wrangler returned empty JSON output");
  try {
    return JSON.parse(text);
  } catch {}
  const starts = [text.indexOf("["), text.indexOf("{")].filter((index) => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    for (let end = text.length; end > start; end -= 1) {
      const candidate = text.slice(start, end).trim();
      if (!candidate.endsWith("]") && !candidate.endsWith("}")) continue;
      try { return JSON.parse(candidate); } catch {}
    }
  }
  throw new Error("Wrangler returned malformed JSON output");
}

export function parseD1CreateOutput(output) {
  const text = String(output ?? "");
  const patterns = [
    /["']?database_id["']?\s*[:=]\s*["']([a-f\d-]{32,36})["']/i,
    /\b([a-f\d]{8}-[a-f\d]{4}-[1-5a-f\d][a-f\d]{3}-[89ab\d][a-f\d]{3}-[a-f\d]{12})\b/i,
    /\b([a-f\d]{32})\b/i,
  ];
  for (const pattern of patterns) {
    const candidate = text.match(pattern)?.[1];
    if (isValidD1DatabaseId(candidate)) return { databaseId: candidate };
  }
  if (/already exists|name already in use|duplicate/i.test(text)) return { conflict: true };
  throw new Error("Could not find a valid D1 database_id in Wrangler output");
}

export function parseD1ListOutput(output) {
  const parsed = extractJson(output);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.result) ? parsed.result : [];
  return rows.flatMap((row) => {
    const name = typeof row?.name === "string" ? row.name : typeof row?.database_name === "string" ? row.database_name : "";
    const databaseId = typeof row?.uuid === "string" ? row.uuid : typeof row?.database_id === "string" ? row.database_id : "";
    return name && isValidD1DatabaseId(databaseId) ? [{ name, databaseId }] : [];
  });
}

export function parseSecretListOutput(output) {
  const parsed = extractJson(output);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.result) ? parsed.result : [];
  return new Set(rows.flatMap((row) => typeof row === "string" ? [row] : typeof row?.name === "string" ? [row.name] : []));
}

export function parseDeployOutput(output) {
  const text = String(output ?? "");
  const urls = text.match(/https:\/\/[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+(?::\d+)?(?:\/[^\s]*)?/gi) ?? [];
  const workersUrl = urls
    .filter((value) => {
      try { return new URL(value).hostname.endsWith(".workers.dev"); } catch { return false; }
    })
    .sort((left, right) => new URL(right).hostname.split(".").length - new URL(left).hostname.split(".").length)[0];
  if (!workersUrl) throw new Error("Could not find a workers.dev URL in Wrangler deploy output");
  return normalizeOrigin(workersUrl);
}

export function isWranglerAuthenticated(result) {
  if (result?.code !== 0) return false;
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  if (/not authenticated|not logged in|please run\s+[`'"]?wrangler login/i.test(output)) return false;
  return /logged in|oauth token|api token|account id/i.test(output);
}

export function normalizeOrigin(value, { allowLoopbackHttp = true } = {}) {
  let url;
  try { url = new URL(String(value ?? "").trim()); } catch { throw new Error("Enter a valid absolute deployment origin"); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(allowLoopbackHttp && loopback && url.protocol === "http:")) {
    throw new Error("Deployment origin must use https");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Deployment origin must not contain credentials, a path, query, or fragment");
  }
  return url.origin;
}

export function stripJsonComments(source) {
  const text = String(source ?? "");
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (char === "\n") { lineComment = false; result += char; }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; }
      else if (char === "\n") result += char;
      continue;
    }
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; result += char; continue; }
    if (char === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    result += char;
  }
  if (inString || blockComment) throw new Error("Invalid JSONC template");
  return result;
}

export function parseWranglerConfig(source) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonComments(source).replace(/,\s*([}\]])/g, "$1"));
  } catch (error) {
    throw new Error(`Invalid wrangler JSONC: ${error instanceof Error ? error.message : "parse failed"}`);
  }
  const database = Array.isArray(parsed?.d1_databases) ? parsed.d1_databases.find((entry) => entry?.binding === "DB") : undefined;
  const databaseId = typeof database?.database_id === "string" ? database.database_id : "";
  const appUrl = typeof parsed?.vars?.APP_URL === "string" ? parsed.vars.APP_URL : "";
  return {
    config: parsed,
    databaseId: isValidD1DatabaseId(databaseId) ? databaseId : "",
    appUrl: appUrl ? normalizeOrigin(appUrl) : "",
  };
}

export function generateWranglerConfig(template, { databaseId, appUrl = "" }) {
  if (!isValidD1DatabaseId(databaseId)) throw new Error("A valid D1 database_id is required");
  const { config } = parseWranglerConfig(template);
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const database = databases.find((entry) => entry?.binding === "DB");
  if (!database) throw new Error("wrangler.example.jsonc must contain a DB D1 binding");
  database.database_id = databaseId;
  if (appUrl) config.vars = { ...(config.vars ?? {}), APP_URL: normalizeOrigin(appUrl) };
  else if (config.vars && "APP_URL" in config.vars) delete config.vars.APP_URL;
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function updateWranglerAppUrl(source, appUrl) {
  const parsed = parseWranglerConfig(source);
  if (!parsed.databaseId) throw new Error("wrangler.jsonc does not contain a valid D1 database_id");
  parsed.config.vars = { ...(parsed.config.vars ?? {}), APP_URL: normalizeOrigin(appUrl) };
  return `${JSON.stringify(parsed.config, null, 2)}\n`;
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(value, secrets = []) {
  let redacted = String(value ?? "");
  const marked = [...new Set([...secrets].filter((secret) => typeof secret === "string" && secret.length > 0))]
    .sort((left, right) => right.length - left.length);
  for (const secret of marked) redacted = redacted.replace(new RegExp(escapePattern(secret), "g"), "•••");
  redacted = redacted
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1•••")
    .replace(/((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, "$1•••");
  return redacted;
}

export function createOutputFormatter(initialSecrets = []) {
  const secrets = new Set(initialSecrets);
  return {
    markSecret(value) { if (typeof value === "string" && value) secrets.add(value); },
    format(value) { return redactSecrets(value, secrets); },
    secretCount() { return secrets.size; },
  };
}

export function parseEnvFile(source) {
  const values = {};
  for (const line of String(source ?? "").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^([A-Z][A-Z\d_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function updateEnvFile(source, updates) {
  const remaining = new Map(Object.entries(updates).filter(([, value]) => typeof value === "string"));
  const lines = String(source ?? "").split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z\d_]*)=/);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  if (lines.at(-1) === "") lines.pop();
  if (remaining.size) {
    if (lines.length) lines.push("");
    for (const [name, value] of remaining) lines.push(`${name}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export function planSetupSteps(state = {}) {
  const done = {
    preflight: Boolean(state.preflightReady),
    cloudflare: Boolean(state.cloudflareAuthenticated),
    database: Boolean(state.databaseConfigured),
    migrations: Boolean(state.migrationsApplied),
    deploy: Boolean(state.deployed && state.appUrl),
    secrets: Boolean(state.requiredSecretsPresent),
    xApplication: Boolean(state.xConfigured),
    healthcheck: Boolean(state.healthy),
  };
  return SETUP_STEPS.map((step) => ({ ...step, status: done[step.id] ? "done" : "pending" }));
}

export function isD1NameConflict(result) {
  return result?.code !== 0 && /already exists|name already in use|duplicate/i.test(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
}
