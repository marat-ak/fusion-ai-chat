/*
  The debug-host build flavour of the app shell (spec §17.1): `ojet build --release --user-options=debug-host`
  (npm run build:debug-host). The same shell, build and JET runtime as the dev/e2e host page, with
  - the page debug-host/index.html in place of src/index.html (before injection, so theme/font/scripts are injected),
  - main.js loading ./debug-host/root (the pod proxy rest helper) instead of ./root (the dev mock rest helper): the
    rest-helper choice is fixed per build, and the mock's modules are removed from this build's output,
  - everything served from the build output, no CDN: JET 19, the Redwood theme and the Core Pack come from
    node_modules (path_mapping "use": "local"); Oracle's UX icon font (oj-ux-ico-*), which JET's tooling links from
    Oracle's CDN (oraclejetconfig.json fontUrl), is downloaded into the build at the same pinned version,
  - the bundle named by its content hash (js/bundle.<sha256:16>.js), so the static server may cache it forever,
  - the finished build delivered whole at the fixed path dist/debug-host/ (replaced on every build): agent-ui's image
    copies that folder at build time and serves it at /ai-chat-debug/.
  Any other --user-options value fails the build.
*/

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FLAVOUR = 'debug-host';
const ENTRY_FROM = "require(['./root']);";
const ENTRY_TO = "require(['./debug-host/root']);";

/** The flavour this build asks for: null (the dev/e2e shell) or 'debug-host'; anything else is refused. */
function flavourOf(configObj) {
  const u = configObj.userOptions;
  if (u === undefined || u === null || u === '') return null;
  if (u !== FLAVOUR) throw new Error(`unknown --user-options "${u}" (known: ${FLAVOUR})`);
  return FLAVOUR;
}

function stagingDir(configObj) {
  const dir = configObj.opts && configObj.opts.stagingPath;
  if (!dir) throw new Error('debug-host: the build context has no opts.stagingPath');
  return path.resolve(dir);
}

/** before_injection: the debug host's page and entry module replace the dev shell's. */
function stageShell(configObj) {
  if (configObj.buildType !== 'release') {
    throw new Error('the debug-host flavour is a release build: ojet build --release --user-options=debug-host');
  }
  const web = stagingDir(configObj);
  fs.copyFileSync(path.resolve('debug-host', 'index.html'), path.join(web, 'index.html'));
  const mainJs = path.join(web, 'js', 'main.js');
  const main = fs.readFileSync(mainJs, 'utf8');
  if (!main.includes(ENTRY_FROM)) throw new Error(`debug-host: ${mainJs} has no ${ENTRY_FROM}`);
  fs.writeFileSync(mainJs, main.replace(ENTRY_FROM, ENTRY_TO));
  console.log('[debug-host] page debug-host/index.html, entry ./debug-host/root');
}

/** The pinned UX icon font: oraclejetconfig.json fontUrl (…/gallery/<version>/images/iconfont/ojuxIconFont.min.css). */
function iconFont() {
  const { fontUrl } = JSON.parse(fs.readFileSync('oraclejetconfig.json', 'utf8'));
  const m = /^(https:\/\/[^?#]+\/gallery\/([0-9.]+)\/images\/iconfont\/)(ojuxIconFont\.min\.css)$/.exec(fontUrl || '');
  if (!m) throw new Error(`debug-host: oraclejetconfig.json fontUrl is not Oracle's pinned UX icon font URL: ${fontUrl}`);
  return { fontUrl, base: m[1], version: m[2], css: m[3] };
}

/** The file at `url`; null when the CDN answers 404 (only where the caller allows it), any other failure throws. */
async function download(url, allow404 = false) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    const c = e && e.cause;
    const why = c ? [c.code, c.message, ...(Array.isArray(c.errors) ? c.errors.map((x) => `${x.code} ${x.address || ''}`) : [])].filter(Boolean).join('; ') : '';
    throw new Error(`debug-host: GET ${url} failed: ${e.message}${why ? ` (${why})` : ''}`);
  }
  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`debug-host: GET ${url} answered HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Where a downloaded icon font version is kept (node_modules: the checkout's named Docker volume, see scripts/e2e.sh). */
const FONT_CACHE = path.resolve('node_modules', '.cache', 'ojux-iconfont');

/**
 * The pinned icon font in the cache, downloaded once per version: the stylesheet and the woff2/woff faces it names.
 * Oracle's CDN throttles repeated bursts, so builds copy from here instead of downloading every time.
 */
async function ensureIconFont() {
  const font = iconFont();
  const dir = path.join(FONT_CACHE, font.version);
  const manifest = path.join(dir, '.complete.json');
  if (fs.existsSync(manifest)) return { font, dir, ...JSON.parse(fs.readFileSync(manifest, 'utf8')) };
  const tmp = `${dir}.part-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const css = await download(font.fontUrl);
  fs.writeFileSync(path.join(tmp, font.css), css);
  // Browsers take the first face format they support; every current browser supports woff2 (woff kept as the next).
  const faces = [...new Set([...css.toString('utf8').matchAll(/url\('([A-Za-z0-9_]+\.woff2?)'\)/g)].map((x) => x[1]))];
  if (!faces.includes('ojuxIconFont_Rg.woff2')) throw new Error(`debug-host: ${font.fontUrl} names no regular woff2 face`);
  // The stylesheet names faces Oracle's CDN does not publish (e.g. ojuxIconFont_XBlk.woff2 answers 404 there): the copy
  // mirrors the CDN, so such a face is missing here too, and the build says which. The regular face must exist.
  const absent = [];
  for (const f of faces) {
    const data = await download(font.base + f, f !== 'ojuxIconFont_Rg.woff2');
    if (data === null) absent.push(f);
    else fs.writeFileSync(path.join(tmp, f), data);
  }
  const files = [font.css, ...faces.filter((f) => !absent.includes(f))];
  fs.writeFileSync(path.join(tmp, '.complete.json'), JSON.stringify({ files, absent }));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  console.log(`[debug-host] UX icon font ${font.version} downloaded: ${files.length - 1} faces` +
    (absent.length > 0 ? `; not on the CDN either (404): ${absent.join(', ')}` : ''));
  return { font, dir, files, absent };
}

/** Copies the pinned icon font into the build under css/ojux/<version>/; returns the local href and the CDN one. */
async function vendorIconFont(web) {
  const { font, dir, files } = await ensureIconFont();
  const rel = `css/ojux/${font.version}`;
  fs.mkdirSync(path.join(web, rel), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(web, rel, f));
  return { href: `${rel}/${font.css}`, cdn: font.fontUrl };
}

/** after_build: drop the dev shell's modules, serve the icon font locally, name the bundle by its hash, refuse CDN links. */
async function finish(configObj) {
  const web = stagingDir(configObj);
  const js = path.join(web, 'js');
  for (const f of ['dev', 'root.js', 'appController.js']) fs.rmSync(path.join(js, f), { recursive: true, force: true });

  const indexHtml = path.join(web, 'index.html');
  let html = fs.readFileSync(indexHtml, 'utf8');
  const font = await vendorIconFont(web);
  if (!html.includes(`href="${font.cdn}"`)) throw new Error(`debug-host: index.html does not link ${font.cdn}`);
  html = html.replace(`href="${font.cdn}"`, `href="${font.href}"`);

  const bundle = fs.readFileSync(path.join(js, 'bundle.js'));
  const hashed = `bundle.${crypto.createHash('sha256').update(bundle).digest('hex').slice(0, 16)}.js`;
  fs.renameSync(path.join(js, 'bundle.js'), path.join(js, hashed));
  if (!html.includes("src='js/bundle.js'")) throw new Error("debug-host: index.html does not load js/bundle.js");
  html = html.replace("src='js/bundle.js'", `src='js/${hashed}'`);

  const remote = html.match(/(?:href|src)=["']https?:\/\/[^"']+/g);
  if (remote) throw new Error(`debug-host: index.html still loads remote assets: ${remote.join(', ')}`);
  fs.writeFileSync(indexHtml, html);
  console.log(`[debug-host] ${hashed}; dev mock modules removed`);
  deliver(web);
}

/** The delivered build: the page's complete static output, at a fixed path for agent-ui's image build to copy. */
const OUTPUT = path.resolve('dist', 'debug-host');

/** Replaces dist/debug-host/ with the finished staging dir (copied beside it first, so a failed copy leaves no mix). */
function deliver(web) {
  const tmp = `${OUTPUT}.part-${process.pid}`;
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(web, tmp, { recursive: true });
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.renameSync(tmp, OUTPUT);
  console.log(`[debug-host] delivered to ${path.relative(process.cwd(), OUTPUT)}/`);
}

module.exports = { flavourOf, stageShell, finish, FLAVOUR };
