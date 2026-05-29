import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}
