import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const srcWeb = path.join(projectRoot, "src", "web");
const distWeb = path.join(projectRoot, "dist", "web");

await mkdir(distWeb, { recursive: true });
await cp(srcWeb, distWeb, { recursive: true });
