// The link-preview image for a mashup permalink (GET /startups/m/<key>.png):
// "Momentic + Kalshi =" over the fake company's name in big Handjet, with
// its tagline, on the bubble background in assets/og/background.png.
//
// The text is laid out here, sized to fit, then drawn as SVG over the
// background and turned into a PNG by rsvg-convert (apt: librsvg2-bin), so
// the server still needs no npm packages. Text widths come from the font
// files themselves (a tiny TrueType reader below), and rsvg-convert finds the
// same fonts through a fontconfig file that points only at assets/og.
//
// Each image is made once, on first request, and kept in data/og/.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import type { Mashup } from "../lib/mashup.ts";

const W = 1200;
const H = 630;
const LEFT = 76; // side padding, as in the mockup
const AVAIL = W - 2 * LEFT; // 1048
const TOP = 64;
const FOOT_TOP = 523; // where the badge and byline start (baked into the background)

const INK_2 = "#a7aec0";
const PINK = "#ff4fae";
const TAG = "#dfe4f2";

// --- Font metrics ---------------------------------------------------------------

type Font = { upm: number; asc: number; desc: number; advance: (cp: number) => number };

function readFont(path: string): Font {
  const b = readFileSync(path);
  const tables = new Map<string, number>();
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
    const at = 12 + 16 * i;
    tables.set(b.toString("latin1", at, at + 4), b.readUInt32BE(at + 8));
  }
  const t = (tag: string) => {
    const o = tables.get(tag);
    if (o === undefined) throw new Error(`${path}: no ${tag} table`);
    return o;
  };
  const upm = b.readUInt16BE(t("head") + 18);
  const hhea = t("hhea");
  const asc = b.readInt16BE(hhea + 4);
  const desc = b.readInt16BE(hhea + 6);
  const nMetrics = b.readUInt16BE(hhea + 34);
  const hmtx = t("hmtx");
  const adv = (gid: number) => b.readUInt16BE(hmtx + 4 * Math.min(gid, nMetrics - 1));

  // cmap: prefer the full-Unicode format 12 table, else format 4.
  const cmap = t("cmap");
  let sub12 = -1;
  let sub4 = -1;
  for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
    const rec = cmap + 4 + 8 * i;
    const pid = b.readUInt16BE(rec);
    const off = cmap + b.readUInt32BE(rec + 4);
    const fmt = b.readUInt16BE(off);
    if (pid === 3 || pid === 0) {
      if (fmt === 12) sub12 = off;
      else if (fmt === 4) sub4 = off;
    }
  }
  const glyph = (cp: number): number => {
    if (sub12 >= 0) {
      for (let i = 0, n = b.readUInt32BE(sub12 + 12); i < n; i++) {
        const g = sub12 + 16 + 12 * i;
        const start = b.readUInt32BE(g);
        if (cp >= start && cp <= b.readUInt32BE(g + 4)) return b.readUInt32BE(g + 8) + cp - start;
      }
      return 0;
    }
    if (sub4 >= 0 && cp <= 0xffff) {
      const segs = b.readUInt16BE(sub4 + 6) / 2;
      const ends = sub4 + 14;
      const starts = ends + 2 * segs + 2;
      const deltas = starts + 2 * segs;
      const ranges = deltas + 2 * segs;
      for (let i = 0; i < segs; i++) {
        if (cp > b.readUInt16BE(ends + 2 * i)) continue;
        const start = b.readUInt16BE(starts + 2 * i);
        if (cp < start) return 0;
        const delta = b.readInt16BE(deltas + 2 * i);
        const ro = b.readUInt16BE(ranges + 2 * i);
        if (ro === 0) return (cp + delta) & 0xffff;
        const g = b.readUInt16BE(ranges + 2 * i + ro + 2 * (cp - start));
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
    }
    return 0;
  };
  const cache = new Map<number, number>();
  return {
    upm,
    asc,
    desc,
    advance: (cp) => {
      let a = cache.get(cp);
      if (a === undefined) cache.set(cp, (a = adv(glyph(cp))));
      return a;
    },
  };
}

/** Width of `s` in px at font size `size`. */
function width(f: Font, s: string, size: number): number {
  let u = 0;
  for (const ch of s) u += f.advance(ch.codePointAt(0)!);
  return (u / f.upm) * size;
}

/** The baseline of a line box `lineH` tall starting at `top` (CSS centres the glyphs' ascent+descent in it). */
function baseline(f: Font, top: number, size: number, lineH: number): number {
  const content = ((f.asc - f.desc) / f.upm) * size;
  return top + (lineH - content) / 2 + (f.asc / f.upm) * size;
}

/** Greedy word wrap of `tokens` (joined by spaces) into lines no wider than `max`. */
function wrap(f: Font, tokens: string[], size: number, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const t of tokens) {
    const next = cur ? `${cur} ${t}` : t;
    if (cur && width(f, next, size) > max) {
      lines.push(cur);
      cur = t;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// --- Layout -----------------------------------------------------------------------

const x = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

export function ogSvg(m: Mashup, fonts: { eq: Font; name: Font; tag: Font }, backgroundPng: Buffer): string {
  // "A + B + C =", without asides like "(formerly Superset)".
  const parts = m.made_from.map((p) => p.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim());
  const eqTokens = parts.map((p, i) => `${p} ${i === parts.length - 1 ? "=" : "+"}`);
  const eqFull = eqTokens.join(" ");
  const eqSize = Math.max(38, Math.min(64, Math.floor((64 * AVAIL) / width(fonts.eq, eqFull, 64))));
  const eqLines = width(fonts.eq, eqFull, eqSize) <= AVAIL ? [eqFull] : wrap(fonts.eq, eqTokens, eqSize, AVAIL);

  // The name: as big as fits on one line, between 72 and 220px.
  const name = m.name.trim();
  const nameSize = Math.max(72, Math.min(220, Math.floor((220 * AVAIL) / width(fonts.name, name, 220))));
  const nameW = width(fonts.name, name, nameSize);
  const squeeze = nameW > AVAIL; // only a freakishly long name; squash it to fit

  // The tagline: 40px over up to two lines, else smaller.
  let tagSize = 40;
  let tagLines = wrap(fonts.tag, m.tagline.trim().split(/\s+/), tagSize, AVAIL);
  if (tagLines.length > 2) {
    tagSize = 32;
    tagLines = wrap(fonts.tag, m.tagline.trim().split(/\s+/), tagSize, AVAIL).slice(0, 3);
  }

  // Stack: eq lines, 8px, the name (line-height 1.05 plus .08em padding), 20px, the tagline.
  const eqH = eqLines.length * eqSize;
  const nameLine = nameSize * 1.05;
  const nameH = nameLine + nameSize * 0.08;
  const tagLine = tagSize * 1.2;
  const blockH = eqH + 8 + nameH + 20 + tagLines.length * tagLine;
  let y = TOP + Math.max(0, (FOOT_TOP - TOP - blockH) / 2);

  const out: string[] = [];
  for (const line of eqLines) {
    const b = baseline(fonts.eq, y, eqSize, eqSize);
    const spans = line
      .split(/( [+=](?= |$))/)
      .map((s) => (/^ [+=]$/.test(s) ? ` <tspan fill="${PINK}">${s.trim()}</tspan>` : x(s)))
      .join("");
    out.push(`<text xml:space="preserve" x="${LEFT}" y="${b.toFixed(1)}" font-family="'Handjet OG 400'" font-size="${eqSize}" fill="${INK_2}">${spans}</text>`);
    y += eqSize;
  }
  y += 8;
  const nb = baseline(fonts.name, y, nameSize, nameLine);
  out.push(
    `<text xml:space="preserve" x="${LEFT}" y="${nb.toFixed(1)}" font-family="'Handjet OG 600'" font-size="${nameSize}" fill="url(#shine)"${squeeze ? ` textLength="${AVAIL}" lengthAdjust="spacingAndGlyphs"` : ""}>${x(name)}</text>`,
  );
  y += nameH + 20;
  for (const line of tagLines) {
    const b = baseline(fonts.tag, y, tagSize, tagLine);
    out.push(`<text xml:space="preserve" x="${LEFT}" y="${b.toFixed(1)}" font-family="'Instrument Serif'" font-style="italic" font-size="${tagSize}" fill="${TAG}">${x(line)}</text>`);
    y += tagLine;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xml:space="preserve">
<defs>
  <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0.18">
    <stop offset="0" stop-color="#f6f7ff"/><stop offset="0.3" stop-color="#b9e6ff"/>
    <stop offset="0.6" stop-color="#ffd1ec"/><stop offset="0.9" stop-color="#fff4c9"/>
  </linearGradient>
</defs>
<image width="${W}" height="${H}" xlink:href="data:image/png;base64,${backgroundPng.toString("base64")}"/>
${out.join("\n")}
</svg>`;
}

// --- Rendering and the cache ----------------------------------------------------------

export function createOgImages(opts: { root: string; dataDir: string; log?: (s: string) => void }) {
  const assets = join(opts.root, "assets/og");
  const outDir = join(opts.dataDir, "og");
  mkdirSync(join(outDir, "fontcache"), { recursive: true });
  const fontsConf = join(outDir, "fonts.conf");
  writeFileSync(
    fontsConf,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${x(assets)}</dir>\n  <cachedir>${x(join(outDir, "fontcache"))}</cachedir>\n</fontconfig>\n`,
  );
  const fonts = {
    eq: readFont(join(assets, "HandjetOG-400.ttf")),
    name: readFont(join(assets, "HandjetOG-600.ttf")),
    tag: readFont(join(assets, "InstrumentSerif-Italic.ttf")),
  };
  const background = readFileSync(join(assets, "background.png"));
  const pending = new Map<string, Promise<string | null>>();

  function rsvg(svg: string, dest: string): Promise<boolean> {
    return new Promise((resolve) => {
      const p = spawn("rsvg-convert", ["--format", "png", "--width", String(W), "--height", String(H), "--output", dest], {
        env: { ...process.env, FONTCONFIG_FILE: fontsConf },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", (e) => {
        opts.log?.(`og: rsvg-convert unavailable (${e.message})`);
        resolve(false);
      });
      p.on("close", (code) => {
        if (code !== 0) opts.log?.(`og: rsvg-convert exited ${code}: ${err.trim().slice(0, 300)}`);
        resolve(code === 0);
      });
      p.stdin.end(svg);
    });
  }

  /** The PNG's path for this mashup, making it first if need be; null if it can't be made. */
  function imagePath(m: Mashup): Promise<string | null> {
    const file = join(outDir, `${m.key.replace(/[^a-z0-9+-]/g, "_")}.png`);
    if (existsSync(file)) return Promise.resolve(file);
    let job = pending.get(file);
    if (!job) {
      const tmp = `${file}.${process.pid}.tmp`;
      job = rsvg(ogSvg(m, fonts, background), tmp)
        .then(async (ok) => (ok ? (await rename(tmp, file), file) : null))
        .finally(() => pending.delete(file));
      pending.set(file, job);
    }
    return job;
  }

  return { imagePath, svg: (m: Mashup) => ogSvg(m, fonts, background) };
}
