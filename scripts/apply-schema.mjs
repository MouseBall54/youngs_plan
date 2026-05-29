import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Create .env from .env.example and set a PostgreSQL connection string.");
  console.error("Example: DATABASE_URL=postgresql:///youngs_plan?host=/var/run/postgresql");
  process.exit(1);
}

const result = spawnSync("psql", [databaseUrl, "-f", "db/schema.sql"], {
  encoding: "utf8"
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (result.status !== 0 && output.includes('database "youngs_plan" does not exist')) {
  console.error("");
  console.error('The dedicated database "youngs_plan" does not exist yet.');
  console.error("Try: npm run db:create");
  console.error("If that fails with a permission error, ask an administrator to run:");
  console.error("sudo -u postgres createdb -O young youngs_plan");
}

process.exit(result.status ?? 1);
