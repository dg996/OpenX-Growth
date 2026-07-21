#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";

import {
  REQUIRED_SECRET_BYTES,
  SETUP_STEPS,
  createOutputFormatter,
  generateSecretValue,
  generateWranglerConfig,
  isD1NameConflict,
  isWranglerAuthenticated,
  normalizeOrigin,
  parseD1CreateOutput,
  parseD1ListOutput,
  parseDeployOutput,
  parseEnvFile,
  parseSecretListOutput,
  parseWranglerConfig,
  updateEnvFile,
  updateWranglerAppUrl,
} from "./lib.mjs";

const REQUIRED_SECRET_NAMES = Object.freeze(Object.keys(REQUIRED_SECRET_BYTES));
export const SETUP_HELP = `OpenX Growth guided setup

Usage:
  npm run setup
  npm run setup -- --help

Prerequisites:
  - Node.js 22.13 or newer and dependencies installed with npm ci
  - GNU timeout (macOS: brew install coreutils, then add its gnubin to PATH)
  - A Cloudflare account
  - An X developer account when you are ready to connect X (the app can be created later)

You provide:
  - Cloudflare login if Wrangler is not already authenticated
  - workers.dev (recommended) or a custom deployment origin
  - X_CLIENT_ID now or later in Settings -> X account
  - X_CLIENT_SECRET only when X explicitly provides one

The wizard creates:
  - a D1 database bound exactly as DB, migrations, and a Worker deployment
  - gitignored wrangler.jsonc and .env.local files
  - independent SESSION_SECRET, APP_ACCESS_TOKEN, CRON_SECRET, and OPENX_API_TOKEN values

Secrets are saved only in .env.local with mode 600 and uploaded through Wrangler
stdin. The command is resumable, never rotates existing remote secrets, and does
not automate the X Developer Console.

Recommended first run:
  - approve the Cloudflare browser login
  - press Enter to accept workers.dev
  - press Enter to defer X credentials if your X app is not ready
`;

export class SetupFailure extends Error {
  constructor(message, { exitCode = 1, cause } = {}) {
    super(message, { cause });
    this.name = "SetupFailure";
    this.exitCode = exitCode;
  }
}

function quoteShellArgument(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function wrapCommandForTerminal(command, args = [], inputPath = "", platform = process.platform) {
  if (platform === "linux") {
    const commandText = [command, ...args].map(quoteShellArgument).join(" ");
    if (inputPath) {
      return {
        command: "/bin/sh",
        args: [
          "-c",
          'input_path=$1; command_text=$2; /bin/cat "$input_path" | /usr/bin/script -q -c "$command_text" /dev/null',
          "openx-setup",
          inputPath,
          commandText,
        ],
      };
    }
    return { command: "/usr/bin/script", args: ["-q", "-c", commandText, "/dev/null"] };
  }
  if (inputPath) {
    return {
      command: "/bin/sh",
      args: [
        "-c",
        'input_path=$1; shift; /bin/cat "$input_path" | /usr/bin/script -q /dev/null "$@"',
        "openx-setup",
        inputPath,
        command,
        ...args,
      ],
    };
  }
  return { command: "/usr/bin/script", args: ["-q", "/dev/null", command, ...args] };
}

async function createSecretInputFifo() {
  const directory = await mkdtemp(join(tmpdir(), "openx-setup-stdin-"));
  const path = join(directory, "input");
  try {
    const created = await new Promise((resolveCreated) => {
      const child = spawn("/usr/bin/mkfifo", [path], { stdio: "ignore" });
      child.on("error", (error) => resolveCreated({ code: 127, error }));
      child.on("close", (code) => resolveCreated({ code: code ?? 1 }));
    });
    if (created.code !== 0) throw created.error ?? new Error("mkfifo failed");
    await chmod(path, 0o600);
    const handle = await open(path, fsConstants.O_RDWR);
    return { directory, handle, path };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** @param {{ command: string, args?: string[], cwd: string, input?: string, streamOutput?: boolean }} options */
export async function defaultCommandRunner({ command, args = [], cwd, input = "", streamOutput = false }) {
  let fifo = null;
  if (input) {
    try { fifo = await createSecretInputFifo(); }
    catch (error) { return { code: 127, stdout: "", stderr: `Could not create protected command input: ${error.message}` }; }
  }
  return new Promise((resolveRun) => {
    const wrapped = wrapCommandForTerminal(command, args, fifo?.path);
    const child = spawn(wrapped.command, wrapped.args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: [!fifo && process.stdin.isTTY ? "inherit" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let inputSent = false;
    let settled = false;
    const redactInput = (value) => {
      const secret = input.replace(/[\r\n]+$/, "");
      return secret ? value.replaceAll(secret, "•••") : value;
    };
    const sendInputAfterHiddenPrompt = () => {
      if (!input || inputSent || !/Enter a secret value:/i.test(`${stdout}\n${stderr}`)) return;
      inputSent = true;
      void fifo.handle.write(input)
        .then(async () => {
          await fifo.handle.close();
          fifo.handle = null;
        })
        .catch((error) => {
          child.kill();
          stderr += `Could not send protected command input: ${error.message}`;
        });
    };
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (fifo) {
        await fifo.handle?.close().catch(() => {});
        await rm(fifo.directory, { recursive: true, force: true }).catch(() => {});
      }
      resolveRun(result);
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (streamOutput && !input) process.stdout.write(chunk);
      sendInputAfterHiddenPrompt();
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (streamOutput && !input) process.stderr.write(chunk);
      sendInputAfterHiddenPrompt();
    });
    child.on("error", (error) => void finish({ code: 127, stdout: redactInput(stdout), stderr: redactInput(`${stderr}${error.message}`) }));
    child.on("close", (code, signal) => void finish({
        code: code ?? (signal ? 130 : 1),
        signal,
        stdout: redactInput(stdout),
        stderr: redactInput(stderr),
      }));
  });
}

export function createTerminalPrompt({ input = process.stdin, output = process.stdout } = {}) {
  const question = (query, { hidden = false } = {}) => new Promise((resolveQuestion, reject) => {
    if (!hidden) {
      const rl = createInterface({ input, output, terminal: Boolean(output.isTTY) });
      rl.question(query, (answer) => { rl.close(); resolveQuestion(answer); });
      rl.once("SIGINT", () => { rl.close(); reject(new SetupFailure("Setup interrupted. Re-run `npm run setup` to resume.", { exitCode: 130 })); });
      return;
    }
    let muted = false;
    const hiddenOutput = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) output.write(chunk);
        callback();
      },
    });
    const rl = createInterface({ input, output: hiddenOutput, terminal: true });
    rl.question(query, (answer) => {
      muted = false;
      output.write("\n");
      rl.close();
      resolveQuestion(answer);
    });
    muted = true;
    rl.once("SIGINT", () => { rl.close(); reject(new SetupFailure("Setup interrupted. Re-run `npm run setup` to resume.", { exitCode: 130 })); });
  });
  return { ask: question };
}

function parseNodeVersion(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function nodeVersionSupported(version) {
  const [major, minor] = parseNodeVersion(version);
  return major > 22 || (major === 22 && minor >= 13);
}

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

async function readOptional(path) {
  try { return await readFile(path, "utf8"); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(path, value, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, value, { encoding: "utf8", mode });
    await chmod(temporary, mode);
    await rename(temporary, path);
    await chmod(path, mode);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function duration(startedAt, now) {
  return `${Math.max(0, now() - startedAt)}ms`;
}

function commandText(command, args) {
  return [command, ...args].join(" ");
}

async function responseBody(response) {
  if (!response) return null;
  if (typeof response.json === "function") {
    try { return await response.json(); } catch { return null; }
  }
  return response.body ?? null;
}

function responseStatus(response) {
  return Number(response?.status ?? response?.response?.status ?? 0);
}

export async function runSetup(options = {}) {
  const root = resolve(options.root ?? new URL("../..", import.meta.url).pathname);
  const runner = options.runner ?? defaultCommandRunner;
  const httpRunner = options.httpRunner ?? ((url, requestOptions) => fetch(url, requestOptions));
  const prompt = options.prompt ?? createTerminalPrompt({ input: options.input, output: options.output });
  const stdout = options.stdout ?? ((value) => process.stdout.write(`${value}\n`));
  const stderr = options.stderr ?? ((value) => process.stderr.write(`${value}\n`));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const random = options.randomBytes ?? randomBytes;
  const healthTimeoutMs = options.healthTimeoutMs ?? 30_000;
  const healthRetryMs = options.healthRetryMs ?? 1_000;
  const formatter = createOutputFormatter();
  const startedAt = now();
  const summaries = [];
  const paths = {
    package: join(root, "package.json"),
    nodeModules: join(root, "node_modules"),
    wranglerBinary: join(root, "node_modules", ".bin", "wrangler"),
    wranglerTemplate: join(root, "wrangler.example.jsonc"),
    wrangler: join(root, "wrangler.jsonc"),
    envTemplate: join(root, ".env.example"),
    env: join(root, ".env.local"),
  };

  const out = (value = "") => stdout(formatter.format(value));
  const err = (value = "") => stderr(formatter.format(value));
  const run = async (command, args = [], { input = "", streamOutput = false } = {}) => {
    const result = await runner({ command, args, cwd: root, input, streamOutput });
    return { code: Number(result?.code ?? 1), signal: result?.signal, stdout: String(result?.stdout ?? ""), stderr: String(result?.stderr ?? "") };
  };
  const requireRun = async (command, args, failureMessage, optionsForRun = {}) => {
    const result = await run(command, args, optionsForRun);
    if (result.code !== 0) {
      const detail = formatter.format(result.stderr || result.stdout).trim();
      throw new SetupFailure(`${failureMessage}${detail ? `\n${detail}` : ""}`);
    }
    return result;
  };
  const ask = async (query, settings = {}) => String(await prompt.ask(query, settings)).trim();
  const yesNo = async (query, defaultValue = true) => {
    const answer = (await ask(`${query} ${defaultValue ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    throw new SetupFailure("Please answer yes or no, then re-run `npm run setup`.");
  };
  const runStep = async (step, action) => {
    const stepStarted = now();
    out(`[${step.number}/8] ${step.label}`);
    try {
      const result = await action();
      const status = result?.status ?? "complete";
      const note = result?.note ? ` — ${result.note}` : "";
      out(`[${step.number}/8] ${status === "skipped" ? "✔ already done" : "✔ complete"} (${duration(stepStarted, now)})${note}`);
      summaries.push({ ...step, status, durationMs: Math.max(0, now() - stepStarted), note: result?.note ?? "" });
      return result;
    } catch (error) {
      const message = formatter.format(error instanceof Error ? error.message : String(error));
      err(`[${step.number}/8] ✖ failed (${duration(stepStarted, now)}) — ${message}`);
      throw new SetupFailure(message, { exitCode: error instanceof SetupFailure ? error.exitCode : 1, cause: error });
    }
  };

  out("OpenX Growth guided setup");
  out("Secrets are written only to .env.local and sent to Wrangler through stdin.");
  out("Recommended first run: approve Cloudflare, press Enter for workers.dev, and defer X credentials if your X app is not ready.");
  out("Setup creates: D1 binding DB, Worker deployment, wrangler.jsonc, .env.local, and four independent secrets.");
  out("Press Ctrl+C to stop safely; run `npm run setup` again to resume.");

  await runStep(SETUP_STEPS[0], async () => {
    if (!nodeVersionSupported(options.nodeVersion ?? process.version)) throw new SetupFailure("Node.js 22.13 or newer is required.");
    let packageJson;
    try { packageJson = JSON.parse(await readFile(paths.package, "utf8")); } catch { throw new SetupFailure("Run this command from the OpenX Growth repository root."); }
    if (packageJson?.name !== "openx-growth") throw new SetupFailure("Run this command from the OpenX Growth repository root.");
    if (!await exists(paths.nodeModules) || !await exists(paths.wranglerBinary)) throw new SetupFailure("Dependencies are missing. Run `npm ci` first.");
    const timeout = await run("timeout", ["--version"]);
    if (timeout.code !== 0 || !/GNU coreutils/i.test(`${timeout.stdout}\n${timeout.stderr}`)) {
      throw new SetupFailure("GNU `timeout` is required by the verified build. On macOS run `brew install coreutils`, add its gnubin directory to PATH, then re-run setup.");
    }
    for (const file of ["wrangler.jsonc", ".env.local"]) {
      const ignored = await run("git", ["check-ignore", "--quiet", "--", file]);
      if (ignored.code !== 0) throw new SetupFailure(`${file} is not ignored by Git. Stop and add it to .gitignore before setup writes instance data.`);
    }
    return { status: "complete" };
  });

  await runStep(SETUP_STEPS[1], async () => {
    const whoami = await run("npx", ["wrangler", "whoami"]);
    if (isWranglerAuthenticated(whoami)) return { status: "skipped", note: "Cloudflare session is active" };
    out("Cloudflare login is required; Wrangler will open its browser flow.");
    const login = await run("npx", ["wrangler", "login"], { streamOutput: true });
    if (login.code !== 0) throw new SetupFailure("Cloudflare login failed or was declined. Run `npx wrangler login` manually, then re-run setup.");
    const verified = await run("npx", ["wrangler", "whoami"]);
    if (!isWranglerAuthenticated(verified)) throw new SetupFailure("Cloudflare login could not be verified. Run `npx wrangler whoami`, fix authentication, then re-run setup.");
    return { status: "complete" };
  });

  let wranglerSource = await readOptional(paths.wrangler);
  let wranglerState = null;
  let wranglerParseError = null;
  if (wranglerSource) {
    try { wranglerState = parseWranglerConfig(wranglerSource); }
    catch (error) { wranglerParseError = error; }
  }

  await runStep(SETUP_STEPS[2], async () => {
    if (wranglerParseError) {
      throw new SetupFailure(`Existing wrangler.jsonc is invalid and was left unchanged. Fix or remove it manually, then re-run setup.\n${formatter.format(wranglerParseError instanceof Error ? wranglerParseError.message : String(wranglerParseError))}`);
    }
    if (wranglerState?.databaseId) {
      if (await yesNo("Reuse existing database configuration? Existing data will be preserved.", true)) {
        return { status: "skipped", note: "existing D1 binding preserved" };
      }
      const replace = await yesNo("Create a new D1 binding in wrangler.jsonc? The existing remote database will not be deleted.", false);
      if (!replace) throw new SetupFailure("Existing database configuration was left unchanged. Re-run setup when you are ready to choose a database.");
    } else if (wranglerSource) {
      const replace = await yesNo("Existing wrangler.jsonc has no valid DB database_id. Replace its local DB binding? No remote database will be deleted.", false);
      if (!replace) throw new SetupFailure("Existing wrangler.jsonc was left unchanged. Add a valid DB database_id or re-run setup and approve replacement.");
    }
    const template = await readFile(paths.wranglerTemplate, "utf8");
    let databaseName = "openx-growth";
    let result = await run("npx", ["wrangler", "d1", "create", databaseName], { streamOutput: true });
    let databaseId;
    if (result.code === 0) {
      databaseId = parseD1CreateOutput(`${result.stdout}\n${result.stderr}`).databaseId;
    } else if (isD1NameConflict(result)) {
      const listed = await requireRun("npx", ["wrangler", "d1", "list", "--json"], "Could not list existing D1 databases.");
      const existing = parseD1ListOutput(listed.stdout).find((database) => database.name === databaseName);
      if (existing && await yesNo("A D1 database named openx-growth already exists. Reuse it? Existing data will be preserved.", true)) {
        databaseId = existing.databaseId;
      } else {
        const alternate = await ask("Enter an alternate D1 database name [openx-growth-2]: ");
        databaseName = alternate || "openx-growth-2";
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(databaseName)) throw new SetupFailure("D1 database names may contain only letters, numbers, and hyphens.");
        result = await run("npx", ["wrangler", "d1", "create", databaseName], { streamOutput: true });
        if (result.code !== 0) throw new SetupFailure(`D1 creation failed. No database was deleted.\n${formatter.format(result.stderr || result.stdout)}`);
        databaseId = parseD1CreateOutput(`${result.stdout}\n${result.stderr}`).databaseId;
      }
    } else {
      throw new SetupFailure(`D1 creation failed. No database was deleted. Re-run \`${commandText("npx", ["wrangler", "d1", "create", databaseName])}\` after fixing Cloudflare access.\n${formatter.format(result.stderr || result.stdout)}`);
    }
    wranglerSource = generateWranglerConfig(template, { databaseId, appUrl: wranglerState?.appUrl ?? "" });
    await atomicWrite(paths.wrangler, wranglerSource);
    wranglerState = parseWranglerConfig(wranglerSource);
    return { status: "complete", note: "wrangler.jsonc created locally" };
  });

  await runStep(SETUP_STEPS[3], async () => {
    await requireRun("npm", ["run", "db:migrate:remote"], "Remote D1 migrations failed. Verify the DB binding in wrangler.jsonc, then re-run `npm run db:migrate:remote` or setup; migrations are idempotent.", { streamOutput: true });
    return { status: "complete" };
  });

  let cachedSecretList = null;
  let appUrl = wranglerState?.appUrl ?? "";
  await runStep(SETUP_STEPS[4], async () => {
    if (appUrl) {
      const deployedProbe = await run("npx", ["wrangler", "secret", "list", "--config", "wrangler.jsonc", "--format", "json"]);
      if (deployedProbe.code === 0 && await yesNo(`Reuse the deployed instance configured for ${appUrl}?`, true)) {
        cachedSecretList = deployedProbe.stdout;
        return { status: "skipped", note: "existing deployment preserved" };
      }
      appUrl = "";
    }
    let defaultWorkersDomain = !appUrl;
    if (!appUrl) {
      const kind = (await ask("Deployment address [workers.dev/custom] (press Enter for workers.dev): ")).toLowerCase();
      if (kind && !["workers.dev", "workers", "default", "custom"].includes(kind)) throw new SetupFailure("Choose `workers.dev` or `custom`.");
      defaultWorkersDomain = kind !== "custom";
      if (!defaultWorkersDomain) {
        appUrl = normalizeOrigin(await ask("Custom deployment origin (https://...): "), { allowLoopbackHttp: false });
        wranglerSource = updateWranglerAppUrl(await readFile(paths.wrangler, "utf8"), appUrl);
        await atomicWrite(paths.wrangler, wranglerSource);
      }
    }
    await requireRun("npm", ["run", "build"], "Build failed. Fix the reported build error before deploying; no Worker deployment was attempted.", { streamOutput: true });
    const deployed = await requireRun("npm", ["run", "deploy:cloudflare"], "Cloudflare deploy failed. The D1 database remains intact; re-run setup to resume at deployment.", { streamOutput: true });
    if (defaultWorkersDomain && !appUrl) {
      appUrl = parseDeployOutput(`${deployed.stdout}\n${deployed.stderr}`);
      wranglerSource = updateWranglerAppUrl(await readFile(paths.wrangler, "utf8"), appUrl);
      await atomicWrite(paths.wrangler, wranglerSource);
      await requireRun("npm", ["run", "deploy:cloudflare"], "The APP_URL follow-up deploy failed. The first deployment and D1 database remain intact; re-run setup to resume.", { streamOutput: true });
    }
    return { status: "complete", note: `APP_URL configured as ${appUrl}` };
  });

  let envSource = await readOptional(paths.env);
  if (envSource === null) envSource = await readFile(paths.envTemplate, "utf8");
  let localValues = parseEnvFile(envSource);
  const saveEnv = async (updates = {}) => {
    envSource = updateEnvFile(envSource, updates);
    await atomicWrite(paths.env, envSource, 0o600);
    localValues = parseEnvFile(envSource);
  };
  await saveEnv({ APP_URL: appUrl });

  let remoteSecrets = new Set();
  await runStep(SETUP_STEPS[5], async () => {
    const listSecrets = () => requireRun("npx", ["wrangler", "secret", "list", "--config", "wrangler.jsonc", "--format", "json"], "Could not list Worker secrets. Confirm the Worker exists, then re-run setup.");
    let listed = cachedSecretList === null ? await listSecrets() : { stdout: cachedSecretList };
    try {
      remoteSecrets = parseSecretListOutput(listed.stdout);
    } catch {
      out("Wrangler returned incomplete secret-list output; retrying once safely.");
      listed = await listSecrets();
      try {
        remoteSecrets = parseSecretListOutput(listed.stdout);
      } catch {
        throw new SetupFailure("Wrangler did not return a readable secret list after two attempts. No secret was changed; re-run `npm run setup` to resume.");
      }
    }
    for (const name of REQUIRED_SECRET_NAMES) {
      const localValue = localValues[name] ?? "";
      if (localValue) formatter.markSecret(localValue);
      if (remoteSecrets.has(name)) {
        if (!localValue) throw new SetupFailure(`${name} is already set remotely but missing from .env.local. Restore the original value locally; setup will never rotate it silently.`);
        out(`${name}: already set — not rotated`);
        continue;
      }
      const value = localValue || generateSecretValue(name, random);
      formatter.markSecret(value);
      if (!localValue) await saveEnv({ [name]: value });
      const uploaded = await run("npx", ["wrangler", "secret", "put", name, "--config", "wrangler.jsonc"], { input: `${value}\n` });
      if (uploaded.code !== 0) throw new SetupFailure(`Could not upload ${name} through Wrangler stdin. Its value remains only in .env.local; re-run setup to resume.\n${formatter.format(uploaded.stderr || uploaded.stdout)}`);
      remoteSecrets.add(name);
    }

    let xClientId = localValues.X_CLIENT_ID ?? "";
    if (!remoteSecrets.has("X_CLIENT_ID")) {
      if (!xClientId) xClientId = await ask("X_CLIENT_ID (optional now — press Enter to configure it in the next step or later in Settings → X account): ");
      if (xClientId) {
        if (!localValues.X_CLIENT_ID) await saveEnv({ X_CLIENT_ID: xClientId });
        const uploaded = await run("npx", ["wrangler", "secret", "put", "X_CLIENT_ID", "--config", "wrangler.jsonc"], { input: `${xClientId}\n` });
        if (uploaded.code !== 0) throw new SetupFailure(`Could not upload X_CLIENT_ID. Re-run setup to resume.\n${formatter.format(uploaded.stderr || uploaded.stdout)}`);
        remoteSecrets.add("X_CLIENT_ID");
      }
    } else if (remoteSecrets.has("X_CLIENT_ID")) out("X_CLIENT_ID: already set — not rotated");

    if (xClientId || remoteSecrets.has("X_CLIENT_ID")) {
      const localClientSecret = localValues.X_CLIENT_SECRET ?? "";
      if (localClientSecret) formatter.markSecret(localClientSecret);
      if (remoteSecrets.has("X_CLIENT_SECRET")) out("X_CLIENT_SECRET: already set — not rotated");
      else {
        const xClientSecret = localClientSecret || await ask("Optional X_CLIENT_SECRET (input hidden; press Enter for a public PKCE client): ", { hidden: true });
        if (xClientSecret) {
          formatter.markSecret(xClientSecret);
          if (!localClientSecret) await saveEnv({ X_CLIENT_SECRET: xClientSecret });
          const uploaded = await run("npx", ["wrangler", "secret", "put", "X_CLIENT_SECRET", "--config", "wrangler.jsonc"], { input: `${xClientSecret}\n` });
          if (uploaded.code !== 0) throw new SetupFailure(`Could not upload X_CLIENT_SECRET through Wrangler stdin. Its value remains only in .env.local.\n${formatter.format(uploaded.stderr || uploaded.stdout)}`);
          remoteSecrets.add("X_CLIENT_SECRET");
        }
      }
    }
    const envStat = await stat(paths.env);
    if ((envStat.mode & 0o777) !== 0o600) throw new SetupFailure(".env.local permissions could not be restricted to 600.");
    return { status: "complete", note: "existing values preserved; missing values uploaded via stdin" };
  });

  let xConfigured = Boolean(localValues.X_CLIENT_ID || remoteSecrets.has("X_CLIENT_ID"));
  await runStep(SETUP_STEPS[6], async () => {
    const callback = `${appUrl}/api/x/oauth/callback`;
    out("Open https://console.x.com/ and create a dedicated X application.");
    out("Enable OAuth 2.0 and set permissions to Read and Write.");
    out("Scopes: tweet.read tweet.write users.read offline.access");
    out(`Callback URL: ${callback}`);
    out("The callback URL must match character-for-character.");
    if (!xConfigured) {
      out("If your X app is not ready, press Enter. Setup will finish and you can add it later in Settings → X account.");
      const xClientId = await ask("Paste X_CLIENT_ID now, or press Enter to configure it later in Settings → X account: ");
      if (xClientId) {
        await saveEnv({ X_CLIENT_ID: xClientId });
        const uploaded = await run("npx", ["wrangler", "secret", "put", "X_CLIENT_ID", "--config", "wrangler.jsonc"], { input: `${xClientId}\n` });
        if (uploaded.code !== 0) throw new SetupFailure(`Could not upload X_CLIENT_ID. Re-run setup to resume.\n${formatter.format(uploaded.stderr || uploaded.stdout)}`);
        remoteSecrets.add("X_CLIENT_ID");
        xConfigured = true;
        const xClientSecret = await ask("Optional X_CLIENT_SECRET (input hidden; press Enter for a public PKCE client): ", { hidden: true });
        if (xClientSecret) {
          formatter.markSecret(xClientSecret);
          await saveEnv({ X_CLIENT_SECRET: xClientSecret });
          const secretUploaded = await run("npx", ["wrangler", "secret", "put", "X_CLIENT_SECRET", "--config", "wrangler.jsonc"], { input: `${xClientSecret}\n` });
          if (secretUploaded.code !== 0) throw new SetupFailure(`Could not upload X_CLIENT_SECRET through Wrangler stdin. Its value remains only in .env.local.\n${formatter.format(secretUploaded.stderr || secretUploaded.stdout)}`);
          remoteSecrets.add("X_CLIENT_SECRET");
        }
      }
    }
    if (!xConfigured) return { status: "skipped", note: "X configuration deferred; healthcheck will report a warning" };
    return { status: "complete" };
  });

  await runStep(SETUP_STEPS[7], async () => {
    const apiToken = localValues.OPENX_API_TOKEN;
    if (!apiToken) throw new SetupFailure("OPENX_API_TOKEN is unavailable locally, so the protected healthcheck cannot run.");
    formatter.markSecret(apiToken);
    const deadline = now() + healthTimeoutMs;
    let lastMessage = "deployment not ready";
    do {
      try {
        const authorization = { Authorization: `Bearer ${apiToken}`, Accept: "application/json" };
        const signal = AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - now())));
        const complianceResponse = await httpRunner(`${appUrl}/api/compliance`, { headers: authorization, signal });
        const compliance = await responseBody(complianceResponse);
        const complianceStatus = responseStatus(complianceResponse);
        if (complianceStatus === 401) throw new Error("OPENX_API_TOKEN was not accepted by /api/compliance");
        if (complianceStatus === 503 && compliance?.error === "INSTANCE_NOT_CONFIGURED") throw new Error("the instance still needs X_CLIENT_ID and SESSION_SECRET");
        if (complianceStatus !== 200) throw new Error(`/api/compliance returned HTTP ${complianceStatus || "unknown"}`);
        if (compliance?.checks?.accessProtected !== true) throw new Error("accessProtected is not true");
        if (compliance?.checks?.officialApiOnly !== true) throw new Error("officialApiOnly is not true");
        if (xConfigured && compliance?.checks?.xConfigured !== true) throw new Error("X_CLIENT_ID has not propagated to the deployment");

        const statusResponse = await httpRunner(`${appUrl}/api/x/status`, { headers: authorization, signal });
        const statusBody = await responseBody(statusResponse);
        const statusCode = responseStatus(statusResponse);
        if (statusCode === 401) throw new Error("OPENX_API_TOKEN was not accepted by /api/x/status");
        if (statusCode === 503 && statusBody?.error === "APP_ACCESS_TOKEN_REQUIRED") throw new Error("configured deployment is missing APP_ACCESS_TOKEN");
        if (statusCode === 503 && statusBody?.error === "INSTANCE_NOT_CONFIGURED") throw new Error("the instance still needs X_CLIENT_ID and SESSION_SECRET");
        if (statusCode !== 200) throw new Error(`/api/x/status returned HTTP ${statusCode || "unknown"}`);
        if (statusBody?.schema?.state !== "ready") throw new Error(`D1 schema is ${statusBody?.schema?.state ?? "unavailable"}; re-run remote migrations`);
        if (statusBody?.origin?.currentMatchesCanonical !== true) throw new Error("APP_URL does not match the deployed origin; correct vars.APP_URL in wrangler.jsonc and redeploy");

        const postsResponse = await httpRunner(`${appUrl}/api/posts`, { headers: { Accept: "application/json" }, signal });
        if (responseStatus(postsResponse) !== 401) throw new Error("unauthenticated /api/posts did not fail closed with HTTP 401");
        if (!xConfigured || compliance?.checks?.xConfigured !== true) out("Warning: X is not configured yet. Complete step 7 from the in-app guide.");
        return { status: "complete" };
      } catch (error) {
        lastMessage = formatter.format(error instanceof Error ? error.message : String(error));
        if (now() >= deadline) break;
        await sleep(Math.min(healthRetryMs, Math.max(0, deadline - now())));
      }
    } while (now() <= deadline);
    throw new SetupFailure(`Healthcheck failed after retrying for about ${Math.round(healthTimeoutMs / 1000)}s: ${lastMessage}`);
  });

  out("");
  out("Setup complete");
  for (const summary of summaries) out(`✔ [${summary.number}/8] ${summary.label} — ${summary.status} (${summary.durationMs}ms)`);
  out(`Total time: ${duration(startedAt, now)}`);
  out(`Next: open ${appUrl} and sign in with APP_ACCESS_TOKEN from .env.local (store it in a password manager).`);
  out("Then open Settings → X account, save the OAuth credentials, and click Continue with X.");
  out("Finally, open Discover for a read-only sync and create a draft before any optional manual publish test.");
  out("Optional scheduler: configure OPENX_BASE_URL and OPENX_CRON_SECRET as documented in README section 6.");
  return { appUrl, xConfigured, summaries, totalDurationMs: Math.max(0, now() - startedAt) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { process.stdout.write(SETUP_HELP); return; }
  if (args.length > 0) throw new SetupFailure("Only --help is supported in v1.", { exitCode: 64 });
  await runSetup();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    if (/interrupt/i.test(message)) process.stderr.write("Re-run `npm run setup` to resume; no destructive action was performed.\n");
    process.exitCode = error instanceof SetupFailure ? error.exitCode : 1;
  });
}
