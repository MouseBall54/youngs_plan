import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadRootEnv();

const databaseUrl = process.env.DATABASE_URL ?? "postgresql:///youngs_plan?host=/var/run/postgresql";
const { databaseName, host } = parseDatabaseUrl(databaseUrl);

if (!databaseName) {
  console.error("Could not determine database name from DATABASE_URL.");
  process.exit(1);
}

const args = [];
if (host) args.push("-h", host);
args.push(databaseName);

if (databaseExists(databaseName, host)) {
  console.log(`PostgreSQL database "${databaseName}" already exists.`);
  process.exit(0);
}

const result = spawnSync("createdb", args, {
  encoding: "utf8"
});

if (result.status === 0) {
  console.log(`Created PostgreSQL database "${databaseName}".`);
  process.exit(0);
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (output.includes("already exists")) {
  console.log(`PostgreSQL database "${databaseName}" already exists.`);
  process.exit(0);
}

console.error(output.trim());
console.error("");
console.error("The current PostgreSQL role probably cannot create databases.");
console.error(`Ask an administrator to run: sudo -u postgres createdb -O ${process.env.USER ?? "young"} ${databaseName}`);
process.exit(result.status ?? 1);

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

function parseDatabaseUrl(value) {
  const url = new URL(value);
  return {
    databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")),
    host: url.searchParams.get("host") ?? url.hostname
  };
}

function databaseExists(databaseName, host) {
  const args = [];
  if (host) args.push("-h", host);
  const escapedName = databaseName.replaceAll("'", "''");
  args.push("-d", "postgres", "-Atc", `SELECT 1 FROM pg_database WHERE datname = '${escapedName}'`);

  const result = spawnSync("psql", args, {
    encoding: "utf8"
  });

  return result.status === 0 && result.stdout.trim() === "1";
}
