import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

loadRootEnv();

const repoRoot = process.cwd();
const backendPort = Number(process.env.PORT ?? 4000);
const ports = [...new Set([backendPort, 5173, 5174])];
const listeners = findListeners(ports).filter((listener) => isProjectProcess(listener.pid));

if (listeners.length === 0) {
  process.exit(0);
}

for (const listener of listeners) {
  const command = readCommand(listener.pid);
  console.log(`Stopping stale dev process on port ${listener.port}: pid ${listener.pid} ${command}`);
  try {
    process.kill(listener.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

await waitForExit(listeners.map((listener) => listener.pid), 2_000);

for (const listener of listeners.filter((listener) => processExists(listener.pid))) {
  console.log(`Force stopping stale dev process: pid ${listener.pid}`);
  try {
    process.kill(listener.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function findListeners(targetPorts) {
  const result = spawnSync("ss", ["-lntp"], { encoding: "utf8" });
  if (result.status !== 0) return [];

  const target = new Set(targetPorts.map(String));
  const listeners = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const portMatch = line.match(/:(\d+)\s+/);
    const pidMatch = line.match(/pid=(\d+)/);
    if (!portMatch || !pidMatch || !target.has(portMatch[1])) continue;

    listeners.push({
      port: Number(portMatch[1]),
      pid: Number(pidMatch[1])
    });
  }

  return uniqueListeners(listeners);
}

function uniqueListeners(listeners) {
  const seen = new Set();
  return listeners.filter((listener) => {
    const key = `${listener.port}:${listener.pid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isProjectProcess(pid) {
  const cwd = readCwd(pid);
  if (!cwd || !isInside(cwd, repoRoot)) return false;

  const command = readCommand(pid);
  return /\b(node|npm|vite|tsx)\b|MainThread/.test(command);
}

function isInside(child, parent) {
  const normalizedChild = resolve(child);
  const normalizedParent = resolve(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function readCwd(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

function readCommand(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
  } catch {
    return "";
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pids, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pids.every((pid) => !processExists(pid))) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

function loadRootEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}
