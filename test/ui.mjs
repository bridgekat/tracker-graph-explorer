/* Drive the built page with real mouse input over CDP, and assert on what happens.
   No extension involved: this launches its own headless browser. */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { marked } from "marked";
import { createServer } from "node:http";
import { readFile } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

/* whichever Chromium this machine has */
const BROWSERS = [
  process.env.BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const EDGE = BROWSERS.find((p) => existsSync(p));
if (!EDGE) {
  console.error("no Chromium found; set BROWSER=<path to chrome or edge>");
  process.exit(2);
}
const PORT = 9333, SERVE = 8731;
const profile = mkdtempSync(join(tmpdir(), "uitest-"));

/* the graph to test against: this project's own, wherever it was exported to */
const GRAPH = [process.argv[2], "numlib.json", "../numlib.json"].filter(Boolean).find(existsSync);
if (!GRAPH) {
  console.error("no graph to test with. Pass one: npm test -- path/to/graph.json");
  process.exit(2);
}

/* serve the built page and the graph, so the test needs nothing running */
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  const file = p === "/graph.json" ? GRAPH : join(process.cwd(), p === "/" ? "index.html" : p);
  readFile(file, (e, d) => {
    if (e) { res.writeHead(404); res.end("not here"); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(d);
  });
}).listen(SERVE);
const URL_ = `http://localhost:${SERVE}/index.html?graph=graph.json`;

const child = spawn(EDGE, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1600,1000", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("no debugger target");
}

let ws, seq = 0;
const waiting = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => waiting.set(id, { res, rej }));
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
  return r.result.value;
}
async function clickAt(x, y) {
  const base = { x, y, button: "left", clickCount: 1, buttons: 1 };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await sleep(30);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
  await sleep(450);
}
async function dragBy(x, y, dx, dy) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 6; i++) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: x + (dx * i) / 6, y: y + (dy * i) / 6, button: "left", buttons: 1,
    });
    await sleep(16);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + dx, y: y + dy, button: "left", clickCount: 1, buttons: 0 });
  await sleep(300);
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? "  — " + detail : ""}`);
};

/* where a group's box and its toggle are, in CSS pixels */
const locate = (prefix) => `
  const g = [...document.querySelectorAll('#exSvg .ex-node.grp')]
    .find(e => e.getAttribute('aria-label').startsWith(${JSON.stringify(prefix)}));
  if (!g) return null;
  const box = g.querySelector(':scope > .ex-box, :scope > .ex-cbg').getBoundingClientRect();
  const tog = g.querySelector('.ex-toggle rect').getBoundingClientRect();
  return {
    body: [Math.round(box.x + 14), Math.round(box.y + box.height / 2)],
    toggle: [Math.round(tog.x + tog.width / 2), Math.round(tog.y + tog.height / 2)],
  };`;

/* --- what can be checked without a browser at all --- */
{
  const g = JSON.parse(readFileSync(GRAPH, "utf8"));
  const texts = [...g.nodes.map((n) => n.desc || ""), ...g.groups.map((x) => x.desc || "")].filter(Boolean);
  let bad = 0, first = "";
  for (const t of texts) {
    try { marked.lexer(t); } catch (e) { bad++; if (!first) first = e.message; }
  }
  check("every doc comment parses", bad === 0, `${texts.length} descriptions${first ? " — " + first : ""}`);

  /* Nothing a graph file says may become markup, and the way to know that is that no
     component ever hands one to the DOM as HTML. */
  const src = readdirSync("src").filter((f) => f.endsWith(".svelte"))
    .map((f) => readFileSync("src/" + f, "utf8")).join("\n");
  check("no component renders raw HTML", !src.includes("{@html"), "no {@html} in src/*.svelte");
}

try {
  ws = new WebSocket(await target());
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: URL_ });
  await sleep(3500);

  check("standards mode", (await evaluate("return document.compatMode")) === "CSS1Compat");
  const loaded = await evaluate("return document.querySelectorAll('#exSvg .ex-node').length");
  check("graph drawn", loaded > 0, `${loaded} boxes`);

  /* --- select: click the body of a box --- */
  let at = await evaluate(locate("Numlib/Krylov,"));
  await clickAt(...at.body);
  let after = await evaluate(`return {
    title: document.querySelector('#exDetail h3') && document.querySelector('#exDetail h3').textContent,
    sel: document.querySelectorAll('#exSvg .ex-node.sel').length }`);
  check("click a box selects it", after.title === "Krylov" && after.sel === 1,
    `detail=${after.title} outlined=${after.sel}`);

  /* --- expand: click the + --- */
  const before = await evaluate("return document.getElementById('exStats').textContent");
  at = await evaluate(locate("Numlib/Krylov,"));
  await clickAt(...at.toggle);
  let stats = await evaluate("return document.getElementById('exStats').textContent");
  const opened = await evaluate(`return !![...document.querySelectorAll('#exSvg .ex-node.grp')]
    .find(e => e.getAttribute('aria-label') === 'Numlib/Krylov/Arnoldi, 28 results, proved. Enter to open it.')`);
  check("＋ expands the box", stats !== before && opened, `${before} → ${stats}`);

  /* --- the opened group is a container holding its children --- */
  const nested = await evaluate(`
    const k = [...document.querySelectorAll('#exSvg .ex-node.grp')]
      .find(e => e.getAttribute('aria-label').startsWith('Numlib/Krylov,'));
    const kids = k.querySelectorAll(':scope > g > .ex-node').length;
    const kb = k.getBoundingClientRect();
    const one = k.querySelector(':scope > g > .ex-node').getBoundingClientRect();
    return { kids, inside: one.left >= kb.left && one.right <= kb.right && one.top >= kb.top && one.bottom <= kb.bottom };`);
  check("children sit inside the container", nested.kids > 10 && nested.inside, `${nested.kids} children`);

  /* --- collapse: click the − on the container header --- */
  at = await evaluate(locate("Numlib/Krylov,"));
  await clickAt(...at.toggle);
  const back = await evaluate("return document.getElementById('exStats').textContent");
  check("− collapses it again", back === before, `${stats} → ${back}`);

  /* --- a drag pans and does not clear the selection --- */
  const camBefore = await evaluate("return document.getElementById('exScene').getAttribute('transform')");
  await dragBy(760, 620, 150, 60);
  const camAfter = await evaluate("return document.getElementById('exScene').getAttribute('transform')");
  const stillSel = await evaluate("return document.querySelectorAll('#exSvg .ex-node.sel').length");
  check("drag pans the canvas", camBefore !== camAfter);
  check("drag does not clear the selection", stillSel === 1, `${stillSel} outlined`);

  /* --- a drag that starts on a box pans, and is not read as a click on it --- */
  const other = await evaluate(locate("Numlib/Analysis,"));
  const cam2 = await evaluate("return document.getElementById('exScene').getAttribute('transform')");
  await dragBy(other.body[0], other.body[1], 120, 50);
  const cam3 = await evaluate("return document.getElementById('exScene').getAttribute('transform')");
  const stillKrylov = await evaluate(
    "return document.querySelector('#exDetail h3') && document.querySelector('#exDetail h3').textContent");
  check("drag from inside a box pans", cam2 !== cam3);
  check("that drag does not select the box", stillKrylov === "Krylov", `detail=${stillKrylov}`);

  /* --- Markdown, through the pane that actually renders it --- */
  const mdDom = await evaluate(`
    const pick = async (needle) => {
      const q = document.getElementById("exSearch");
      q.value = needle;
      q.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const row = [...document.querySelectorAll("#exTree .tw")]
        .find(r => r.textContent.trim().startsWith(needle));
      if (!row) return null;
      row.click();
      await new Promise(r => setTimeout(r, 500));
      const d = document.getElementById("exDetail");
      return {
        rows: d.querySelectorAll("table tbody tr").length,
        pre: d.querySelectorAll("pre code").length,
        boldCode: d.querySelectorAll("b code, i code").length,
        raw: d.innerHTML.indexOf("&lt;") >= 0 || true,
      };
    };
    const table = await pick("NumlibSurface/SaadSparse");
    const fenced = await pick("Numlib/Krylov/BiLanczos");
    const bold = await pick("Affine.Simplex.diam_mul_sin_sq_le");
    return { table, fenced, bold };
  `);
  check("a table in a doc comment renders as a table", mdDom.table && mdDom.table.rows > 20,
    (mdDom.table ? mdDom.table.rows : 0) + " rows");
  check("a fenced block renders as one", mdDom.fenced && mdDom.fenced.pre > 0,
    (mdDom.fenced ? mdDom.fenced.pre : 0) + " code blocks");
  check("code inside bold is code", mdDom.bold && mdDom.bold.boldCode > 0,
    (mdDom.bold ? mdDom.bold.boldCode : 0) + " in diam_mul_sin_sq_le");

  /* --- focusing a declaration deep inside a container --- */
  const deep = await evaluate(`
    const q = document.getElementById('exSearch');
    q.value = 'isMinResIterate';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    document.querySelectorAll('#exTree .tw')[0].click();
    await new Promise(r => setTimeout(r, 1200));
    const direct = [...document.querySelectorAll('.ex-edge.lit-direct:not(.back)')];
    const cs = direct.length ? getComputedStyle(direct[0]) : null;
    const dash = cs ? cs.strokeDasharray : '';
    const wide = cs ? parseFloat(cs.strokeWidth) : 0;
    const lit = document.querySelector('.ex-edge.lit-down:not(.back)');
    const litWide = lit ? parseFloat(getComputedStyle(lit).strokeWidth) : 0;
    /* a shut box that holds something in the cone must stay lit, or the cone lies */
    const shutLit = [...document.querySelectorAll('#exSvg .ex-node.grp:not(.open):not(.dim)')].length;
    return {
      sel: document.querySelector('#exDetail h3') && document.querySelector('#exDetail h3').textContent,
      direct: direct.length,
      down: document.querySelectorAll('.ex-edge.lit-down').length,
      dim: document.querySelectorAll('.ex-node.dim').length,
      dash, wide, litWide, shutLit,
    };`);
  check("focusing a deep declaration lights its own lines", deep.sel === "isMinResIterate" && deep.direct > 0,
    `${deep.direct} direct, ${deep.down} in the cone`);
  check("dashed still means only a reversed edge", deep.dash === "none", deep.dash);
  check("the focused box's lines are the heaviest", deep.wide > deep.litWide,
    `${deep.wide}px vs ${deep.litWide}px`);
  check("shut boxes holding cone nodes stay lit", deep.shutLit > 0 && deep.dim > 0,
    `${deep.shutLit} lit shut boxes, ${deep.dim} dimmed`);

  /* --- the panes resize by dragging the splitter between them --- */
  const gw = await evaluate("return document.getElementById('exSide').getBoundingClientRect().width");
  const grip = await evaluate(
    "const r = document.querySelectorAll('[role=\\'separator\\']')[0].getBoundingClientRect();" +
    "return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]");
  await dragBy(grip[0], grip[1], 90, 0);
  await evaluate("await new Promise(r=>setTimeout(r,200)); return 1");
  const gw2 = await evaluate("return document.getElementById('exSide').getBoundingClientRect().width");
  const vb = await evaluate("return document.getElementById('exSvg').getAttribute('viewBox')");
  const vw = await evaluate("return document.getElementById('exViewport').clientWidth");
  check("dragging the splitter resizes the pane", Math.abs(gw2 - gw - 90) < 8, `${gw} → ${gw2}`);
  check("the canvas follows the new width", vb.split(" ")[2] === String(vw), `${vb} vs ${vw}`);

  /* --- zoom buttons --- */
  const z0 = await evaluate("return document.getElementById('exZoomLab').textContent");
  await evaluate("document.getElementById('exZoomIn').click(); await new Promise(r=>setTimeout(r,120)); return 1");
  const z1 = await evaluate("return document.getElementById('exZoomLab').textContent");
  check("zoom in changes the scale", z0 !== z1, `${z0} → ${z1}`);

  /* --- the progress overlay --- */
  const prog = await evaluate(`
    const g = [...document.querySelectorAll('#exSvg .ex-node.grp')]
      .find(e => e.getAttribute('aria-label').startsWith('Numlib/Eigen,'));
    const box = g.querySelector(':scope > .ex-box');
    const p = g.querySelector(':scope > .ex-prog');
    return { h: +box.getAttribute('height'), ph: +p.getAttribute('height'), py: +p.getAttribute('y'),
             pw: +p.getAttribute('width'), bw: +box.getAttribute('width'),
             clip: !!p.getAttribute('clip-path'), fill: p.getAttribute('fill') };`);
  check("progress fills the box height, clipped by it",
    prog.ph === prog.h && prog.py === 0 && prog.clip && /rgba\(0, 0, 0/.test(prog.fill) && prog.pw < prog.bw,
    `${prog.pw.toFixed(1)}/${prog.bw} wide, ${prog.ph}/${prog.h} tall, ${prog.fill}`);

  const errs = await evaluate("return (window.__errs||[]).length");
  check("no page errors", !errs);
} catch (e) {
  check("harness", false, e.message);
} finally {
  try { ws && ws.close(); } catch { }
  server.close();
  child.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { }
}

const bad = results.filter((r) => !r.ok).length;
console.log(bad ? `\n${bad} of ${results.length} checks failed` : `\nall ${results.length} checks passed`);
process.exit(bad ? 1 : 0);
