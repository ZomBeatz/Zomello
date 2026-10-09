import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

/** Zomello's data folder (matches Tauri's app_data_dir for our identifier). */
function dataDir() {
  const id = "com.zombeatz.zomello";
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? os.homedir(), id);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", id);
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), id);
}

/** Dev only: serve stored attachments at /__zfile/... (the dev page can't load the app's zfile:// scheme). */
const devAttachments = {
  name: "zomello-dev-attachments",
  configureServer(server: { middlewares: { use: (p: string, fn: (req: { url?: string }, res: NodeJS.WritableStream & { statusCode: number; end: (b?: unknown) => void }, next: () => void) => void) => void } }) {
    const root = path.join(dataDir(), "attachments");
    server.middlewares.use("/__zfile/attachments", (req, res, next) => {
      const rel = decodeURIComponent((req.url ?? "").split("?")[0]);
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return next();
      const types: Record<string, string> = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
        ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp",
      };
      (res as unknown as { setHeader: (k: string, v: string) => void }).setHeader(
        "Content-Type",
        types[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      );
      fs.createReadStream(file).pipe(res);
    });
  },
};

export default defineConfig({
  plugins: [react(), devAttachments],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
