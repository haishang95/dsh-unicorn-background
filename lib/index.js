/**
 * Host half of `dsh-unicorn-background`.
 *
 * Owns the wallpaper store and the routes the browser half talks to. Every route
 * is `exact`, which is what lets it past DSH's index-route trust fence; the
 * mutating ones additionally refuse anything that is not a loopback caller.
 *
 *   GET  /dsh-user-background/config       settings + stored wallpapers
 *   POST /dsh-user-background/config       merge settings
 *   GET  /dsh-user-background/image.jpg    the selected wallpaper bytes
 *   POST /dsh-user-background/upload       store a wallpaper (?name=<filename>)
 *   POST /dsh-user-background/remove       delete a stored wallpaper (?name=)
 *   GET  /dsh-user-background/wallpaper.js browser half, read fresh per request
 *   GET  /dsh-user-background/state        browser diagnostics
 *
 * The `/dsh-user-background` prefix and the `user-background` data directory are
 * kept from the package's former name, so the open page, its saved preferences
 * and the stored wallpapers all survive the rename.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "assets");
const PREFIX = "/dsh-user-background";
const DEFAULT_IMAGE = "default";
const MAX_UPLOAD = 24 * 1024 * 1024;

const TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
]);

/** Baseline for a fresh store; the browser half keeps its own "设为默认" layer. */
const DEFAULTS = {
  enabled: true,
  image: "CYP3A2_Happy_Launch_Day_to_HMS_Unicorn__13768138-muwqc0bu.png",
  sidebar: 20,
  center: 60,
  panel: 100,
  blur: 0,
  saturate: 160,
  anchor: "bl",
};

const home = process.env.DSH_HOME && process.env.DSH_HOME !== ""
  ? process.env.DSH_HOME
  : join(homedir(), ".dsh");
const dataDir = join(home, "user-background");
const imagesDir = join(dataDir, "images");
const configPath = join(dataDir, "config.json");

let report = null;

function ensureStore() {
  try {
    mkdirSync(imagesDir, { recursive: true });
  } catch {
    /* an unwritable store surfaces when a route needs it */
  }
}

function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const merged = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (parsed[key] !== undefined) merged[key] = parsed[key];
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

function writeConfig(patch) {
  ensureStore();
  const next = { ...readConfig() };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key in DEFAULTS) next[key] = value;
  }
  next.updatedAt = new Date().toISOString();
  const temporary = `${configPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(temporary, configPath);
  return next;
}

function listImages() {
  const entries = [{ name: DEFAULT_IMAGE, size: bundledImage()?.length ?? 0, builtin: true }];
  try {
    for (const name of readdirSync(imagesDir)) {
      if (!TYPES.has(extname(name).toLowerCase())) continue;
      try {
        entries.push({ name, size: statSync(join(imagesDir, name)).size, builtin: false });
      } catch {
        /* a file that vanished between readdir and stat */
      }
    }
  } catch {
    /* no store yet */
  }
  return entries;
}

function bundledImage() {
  try {
    return readFileSync(join(assets, "background.jpg"));
  } catch {
    return undefined;
  }
}

/** Resolve one named wallpaper: the packaged default, or a stored file. */
function imageByName(name) {
  if (name === DEFAULT_IMAGE) {
    const bytes = bundledImage();
    return bytes === undefined ? undefined : { bytes, name: DEFAULT_IMAGE };
  }
  const base = basename(String(name ?? ""));
  if (!TYPES.has(extname(base).toLowerCase())) return undefined;
  const candidate = join(imagesDir, base);
  if (!existsSync(candidate)) return undefined;
  return { bytes: readFileSync(candidate), name: base };
}

function currentImage(config) {
  return imageByName(config.image) ?? imageByName(DEFAULT_IMAGE);
}

/** Every stored name is generated here, so a query value never becomes a path. */
function storedName(raw) {
  const base = basename(String(raw ?? "")).replace(/[^A-Za-z0-9._-]/g, "_");
  const extension = extname(base).toLowerCase();
  if (!TYPES.has(extension)) return undefined;
  const stem = base.slice(0, base.length - extension.length).replace(/^[._-]+/u, "").slice(0, 48) || "image";
  return `${stem}-${Date.now().toString(36)}${extension}`;
}

function loopback(req) {
  const address = req.socket?.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function send(res, status, type, body) {
  const length = typeof body === "string" ? Buffer.byteLength(body) : body.length;
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Length": String(length),
  });
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const ROW_TEXT =
  "(function(){try{if(window.__dshUserBackgroundScript){return}window.__dshUserBackgroundScript=true;"
  + "var d=document.body||document.head||document.documentElement;if(!d){return}"
  + "var s=document.createElement('script');s.src='" + PREFIX + "/wallpaper.js';s.async=true;d.appendChild(s)"
  + "}catch(e){}})()";

export default {
  name: "dsh-unicorn-background",
  apply(root) {
    ensureStore();

    // Registered synchronously: the desktop shell collects injection rows once, at boot.
    root.on("webserver/index-inject", (table) => {
      try {
        if (!Array.isArray(table)) return;
        for (const row of table) {
          if (row && typeof row.text === "string" && row.text.includes(`${PREFIX}/wallpaper.js`)) return;
        }
        table.push({ kind: "script", placement: "body", text: ROW_TEXT });
      } catch {
        /* a malformed table is not this plugin's to repair */
      }
    });

    root.inject(["webServer"], (ctx) => {
      const route = (path, handler) =>
        ctx.effect(() => ctx.webServer.register({ kind: "exact", path, handler }));

      route(`${PREFIX}/config`, async (req, res) => {
        if (req.method === "POST") {
          if (!loopback(req)) {
            json(res, 403, { ok: false, error: "loopback only" });
            return;
          }
          try {
            const body = await readBody(req, 64 * 1024);
            const patch = JSON.parse(body.toString("utf8") || "{}");
            const config = writeConfig(patch);
            json(res, 200, { ok: true, config, images: listImages() });
          } catch (error) {
            json(res, 400, { ok: false, error: String(error?.message ?? error) });
          }
          return;
        }
        json(res, 200, {
          ok: true,
          config: readConfig(),
          images: listImages(),
          defaults: DEFAULTS,
          // Lets the browser half use per-image previews; an older host omits this.
          capabilities: { namedImage: true },
        });
      });

      route(`${PREFIX}/image.jpg`, (req, res) => {
        try {
          // `?name=` serves one specific wallpaper, which is what thumbnails need.
          // Without it the selected wallpaper answers, for older callers.
          const requested = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("name");
          const picked = requested === null ? currentImage(readConfig()) : imageByName(requested);
          if (picked === undefined) {
            send(res, 404, "text/plain; charset=utf-8", "no wallpaper available");
            return;
          }
          send(res, 200, TYPES.get(extname(picked.name).toLowerCase()) ?? "image/jpeg", picked.bytes);
        } catch {
          send(res, 404, "text/plain; charset=utf-8", "wallpaper unavailable");
        }
      });

      route(`${PREFIX}/upload`, async (req, res) => {
        if (req.method !== "POST") {
          json(res, 405, { ok: false, error: "POST only" });
          return;
        }
        if (!loopback(req)) {
          json(res, 403, { ok: false, error: "loopback only" });
          return;
        }
        const name = storedName(new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("name"));
        if (name === undefined) {
          json(res, 400, { ok: false, error: "unsupported image type" });
          return;
        }
        try {
          const body = await readBody(req, MAX_UPLOAD);
          if (body.length === 0) {
            json(res, 400, { ok: false, error: "empty upload" });
            return;
          }
          ensureStore();
          writeFileSync(join(imagesDir, name), body);
          json(res, 200, { ok: true, name, images: listImages() });
        } catch (error) {
          json(res, 400, { ok: false, error: String(error?.message ?? error) });
        }
      });

      route(`${PREFIX}/remove`, (req, res) => {
        if (!loopback(req)) {
          json(res, 403, { ok: false, error: "loopback only" });
          return;
        }
        const name = basename(String(new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("name") ?? ""));
        if (name === "" || name === DEFAULT_IMAGE || !TYPES.has(extname(name).toLowerCase())) {
          json(res, 400, { ok: false, error: "not a stored wallpaper" });
          return;
        }
        try {
          rmSync(join(imagesDir, name), { force: true });
          const config = readConfig();
          if (config.image === name) writeConfig({ image: DEFAULT_IMAGE });
          json(res, 200, { ok: true, config: readConfig(), images: listImages() });
        } catch (error) {
          json(res, 400, { ok: false, error: String(error?.message ?? error) });
        }
      });

      // Read per request, so editing the browser half needs no host restart.
      route(`${PREFIX}/wallpaper.js`, (req, res) => {
        try {
          send(res, 200, "application/javascript; charset=utf-8", readFileSync(join(assets, "wallpaper.js"), "utf8"));
        } catch {
          send(res, 404, "text/plain; charset=utf-8", "wallpaper.js unavailable");
        }
      });

      route(`${PREFIX}/state`, (req, res) => {
        try {
          const incoming = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("report");
          if (incoming !== null) report = { report: incoming, at: new Date().toISOString() };
          json(res, 200, { ok: true, last: report });
        } catch {
          send(res, 500, "text/plain; charset=utf-8", "state unavailable");
        }
      });
    });
  },
};
