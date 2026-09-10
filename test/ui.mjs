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
/* One scene becoming the next keeps both in the document for a moment; a check
   that reads the drawing wants the moment over. */
const SETTLE = "for (let i = 0; i < 60 && document.querySelectorAll('#exSvg .ex-scene').length > 1; i++)"
  + " await new Promise(r => setTimeout(r, 50));";
const settled = () => evaluate(SETTLE + " return 1");
async function clickAt(x, y) {
  const base = { x, y, button: "left", clickCount: 1, buttons: 1 };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await sleep(30);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
  await sleep(450);
  await settled();
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

/* where a group's box and its control are, in CSS pixels. The control is at the left of
   the box, so the body is asked for past it rather than at the box's own left edge. */
const locate = (prefix) => `
  const g = [...document.querySelectorAll('#exSvg .ex-node.grp')]
    .find(e => e.getAttribute('aria-label').startsWith(${JSON.stringify(prefix)}));
  if (!g) return null;
  const box = g.querySelector(':scope > .ex-box, :scope > .ex-cbg').getBoundingClientRect();
  const tog = g.querySelector('.ex-toggle rect').getBoundingClientRect();
  return {
    body: [Math.round(tog.right + 12), Math.round(box.y + box.height / 2)],
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
  /* the page follows the system theme, and the checks below read colours: pin it */
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  /* anything the page throws, so that the last check means something */
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__errs = []; addEventListener('error', e => __errs.push(e.message));"
      + " addEventListener('unhandledrejection', e => __errs.push(String(e.reason)));",
  });
  await send("Page.navigate", { url: URL_ });
  await sleep(1500);

  check("standards mode", (await evaluate("return document.compatMode")) === "CSS1Compat");
  const boxes = () => evaluate("return document.querySelectorAll('#exSvg .ex-node').length");
  /* the first layout parses the engine as well as running it; give it a while */
  let loaded = 0;
  for (let i = 0; i < 40 && !loaded; i++) { loaded = await boxes(); if (!loaded) await sleep(250); }
  check("graph drawn", loaded > 0, `${loaded} boxes`);

  /* --- what the build baked in, if anything ---
     A page built around one graph is showing that one, whatever `?graph=` says, and the
     ways of loading another are gone: what stands where they were is the download of the
     graph it was built with. */
  const pinned = await evaluate(`
    return { baked: !!document.getElementById('bakedGraph'),
             src: document.getElementById('srcName').textContent,
             open: !!document.getElementById('fileBtn'),
             save: !!document.getElementById('saveBtn') };`);
  check(pinned.baked ? "a baked graph is the only one, and the page hands it back"
    : "with nothing baked in the page takes a graph and does not offer one",
    pinned.baked ? pinned.save && !pinned.open : pinned.open && !pinned.save,
    `${pinned.src}${pinned.baked ? ", baked in" : ""}`);

  /* --- select: click the body of a box --- */
  let at = await evaluate(locate("Numlib/Krylov,"));
  await clickAt(...at.body);
  let after = await evaluate(`return {
    title: document.querySelector('#exDetail h3') && document.querySelector('#exDetail h3').textContent,
    sel: document.querySelectorAll('#exSvg .ex-node.sel').length }`);
  check("click a box selects it", after.title === "Krylov" && after.sel === 1,
    `detail=${after.title} outlined=${after.sel}`);

  /* where a box's control sits within it, and how wide the box is */
  const anchor = (prefix) => `
    const g = [...document.querySelectorAll('#exSvg .ex-node.grp')]
      .find(e => e.getAttribute('aria-label').startsWith(${JSON.stringify(prefix)}));
    const box = g.querySelector(':scope > .ex-box, :scope > .ex-cbg').getBoundingClientRect();
    const c = g.querySelector(':scope > .ex-toggle rect').getBoundingClientRect();
    return { off: Math.round(c.x - box.x), w: Math.round(box.width) };`;

  /* --- expand: click the ＋ --- */
  const before = await boxes();
  const shutAt = await evaluate(anchor("Numlib/Krylov,"));
  at = await evaluate(locate("Numlib/Krylov,"));
  await clickAt(...at.toggle);
  const more = await boxes();
  /* --- and the control is at the edge that opening does not move ---
     A box grows to hold what is in it, so a control at its right travels the whole of
     that width while you are still looking at it. At the left it stays under the
     pointer, and the same click closes what it just opened. */
  const openAt = await evaluate(anchor("Numlib/Krylov,"));
  check("the control stays put when the box opens",
    shutAt.off <= 1 && openAt.off <= 1 && openAt.w > shutAt.w + 100,
    `${shutAt.off}px in at ${shutAt.w}px wide, ${openAt.off}px in at ${openAt.w}px`);
  const opened = await evaluate(`return !![...document.querySelectorAll('#exSvg .ex-node.grp')]
    .find(e => e.getAttribute('aria-label') === 'Numlib/Krylov/Arnoldi, 28 results, proved. Enter to open it.')`);
  check("＋ expands the box", more > before && opened, `${before} → ${more} boxes`);

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
  const back = await boxes();
  check("− collapses it again", back === before, `${more} → ${back} boxes`);

  /* --- Escape lets go of what is focused ---
     Krylov has been the focused box since it was clicked, and clicking a focused box is
     how you let go of it, so the next click on it would put the drawing back rather than
     select it. This is also the other way of letting go. */
  const esc = await evaluate(`
    document.getElementById('exViewport').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return { sel: document.querySelectorAll('#exSvg .ex-node.sel').length,
             dim: document.querySelectorAll('#exSvg .ex-node.dim').length };`);
  check("Escape lets go of the focused box", !esc.sel && !esc.dim,
    `${esc.sel} outlined, ${esc.dim} dimmed`);

  /* --- selecting an open container fades the graph around it, not what is in it --- */
  at = await evaluate(locate("Numlib/Krylov,"));
  await clickAt(...at.toggle);
  await sleep(300);
  const head = await evaluate(`
    const g = [...document.querySelectorAll('#exSvg .ex-node.grp')]
      .find(e => e.getAttribute('aria-label').startsWith('Numlib/Krylov,'));
    const r = g.querySelector(':scope > .ex-chead').getBoundingClientRect();
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];`);
  await clickAt(...head);
  const within = await evaluate(`
    const k = [...document.querySelectorAll('#exSvg .ex-node.grp')]
      .find(e => e.getAttribute('aria-label').startsWith('Numlib/Krylov,'));
    const edges = [...k.querySelectorAll('.ex-edge')];
    return {
      sel: k.classList.contains('sel'),
      kids: k.querySelectorAll('.ex-node').length,
      dim: k.querySelectorAll('.ex-node.dim').length,
      edges: edges.length,
      faint: edges.filter(e => parseFloat(getComputedStyle(e).opacity) < 0.5).length,
      outside: document.querySelectorAll('#exSvg .ex-node.dim').length,
    };`);
  check("selecting an open container keeps its contents as they were",
    within.sel && within.kids > 0 && within.dim === 0 && within.edges > 0 && within.faint === 0 && within.outside > 0,
    `${within.kids} children, ${within.dim} dimmed; ${within.faint} of ${within.edges} edges faint; ${within.outside} dimmed outside`);
  at = await evaluate(locate("Numlib/Krylov,"));
  await clickAt(...at.toggle);

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

  /* --- an open container answers from its title strip, and not from the room inside ---
     Most of an open container is where its children sit, and a pointer crossing that on
     its way to one of them is not asking about the container. The probes go straight to
     the container's own element, so what is being read is the rule and not whatever
     happens to be drawn at that point. */
  const strip = await evaluate(`
    const g = document.querySelector('#exSvg .ex-node.grp.open');
    if (!g) return null;
    const r = g.querySelector(':scope > .ex-cbg').getBoundingClientRect();
    const probe = async (y) => {
      g.dispatchEvent(new PointerEvent('pointerenter', { clientX: r.x + 30, clientY: y }));
      await new Promise(z => setTimeout(z, 60));
      const shown = !!document.getElementById('tip');
      g.dispatchEvent(new PointerEvent('pointerleave'));
      await new Promise(z => setTimeout(z, 60));
      return shown;
    };
    return { title: await probe(r.y + 4), body: await probe(r.y + r.height / 2) };`);
  check("an open container says what it is from its title, not from the room inside it",
    strip && strip.title && !strip.body,
    strip ? `title ${strip.title}, body ${strip.body}` : "nothing open to ask");

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
      ${SETTLE}
      const d = document.getElementById("exDetail");
      return {
        rows: d.querySelectorAll("table tbody tr").length,
        pre: d.querySelectorAll("pre code").length,
        boldCode: d.querySelectorAll("b code, i code").length,
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
    ${SETTLE}
    /* a lit line is ink, and it is the only thing on the canvas that is; a line the
       layering had to reverse is the only dashed one, lit or not */
    const one = document.querySelector('.ex-edge.lit-down:not(.back)');
    const cs = one ? getComputedStyle(one) : null;
    const faint = [...document.querySelectorAll('#exSvg .ex-edge')]
      .filter(e => !e.classList.contains('lit-down') && !e.classList.contains('lit-up')
        && !e.classList.contains('within'))
      .filter(e => parseFloat(getComputedStyle(e).opacity) > 0.2).length;
    /* a shut box that holds something in the cone must stay lit, or the cone lies */
    const shutLit = [...document.querySelectorAll('#exSvg .ex-node.grp:not(.open):not(.dim)')].length;
    return {
      sel: document.querySelector('#exDetail h3') && document.querySelector('#exDetail h3').textContent,
      down: document.querySelectorAll('.ex-edge.lit-down').length,
      up: document.querySelectorAll('.ex-edge.lit-up').length,
      dim: document.querySelectorAll('.ex-node.dim').length,
      dash: cs ? cs.strokeDasharray : '', lit: cs ? cs.opacity : '',
      widths: [...new Set([...document.querySelectorAll('.ex-edge.lit-down, .ex-edge.lit-up')]
        .map(e => getComputedStyle(e).strokeWidth))],
      faint, shutLit,
    };`);
  check("focusing a deep declaration lights the lines its cone runs along",
    deep.sel === "isMinResIterate" && deep.down > 0 && deep.up > 0,
    `${deep.down} down, ${deep.up} up`);
  check("dashed still means only a reversed edge", deep.dash === "none", deep.dash);
  /* Weight is not one of the things a lit line says: the two halves of the cone are told
     apart by how strongly each is drawn, and every lit line is drawn at the same width as
     every other, so dashed and heavy both go on meaning what they meant. */
  check("a lit line is told apart by its strength, not by its weight",
    deep.widths.length === 1 && parseFloat(deep.lit) > 0.5,
    `${deep.widths.join(", ")} throughout, lit at ${deep.lit}`);
  check("and everything outside the cone is faint", deep.faint === 0 && deep.dim > 0,
    `${deep.faint} un-faded outside it, ${deep.dim} boxes dimmed`);
  check("shut boxes holding cone nodes stay lit", deep.shutLit > 0 && deep.dim > 0,
    `${deep.shutLit} lit shut boxes, ${deep.dim} dimmed`);

  /* --- the link to the API docs, which a build has only if it was given a root ---
     The declaration focused above is still the one in the pane, so this asks whether it
     points at its own anchor on its own module's page. A build given no root must show
     no link at all rather than one that goes nowhere. */
  const docs = await evaluate(`
    const m = document.querySelector('meta[name="docs-root"]');
    const a = [...document.querySelectorAll('#exDetail a')]
      .find(a => a.textContent.trim().startsWith('API docs'));
    return { root: m && m.content, href: a && a.getAttribute('href') };`);
  check(docs.root ? "a declaration links to its own anchor in the API docs"
    : "a build given no docs root links nowhere",
    docs.root
      ? (docs.href || "").startsWith(docs.root + "/Numlib/")
        && docs.href.endsWith(".html#CR.isMinResIterate")
      : !docs.href,
    docs.href || "no link");

  /* --- the address bar, and a link back into the page ---
     A node is addressed one way in this project — the module's path, then the name the
     thing is declared under — and the page says it in the URL and in the detail pane's
     own box. The declaration focused above is still the one in the pane, so the address
     is its. Then a fragment somebody else could have sent: setting one takes the page to
     the node it names. */
  const addr = await evaluate(`
    return { hash: decodeURIComponent(location.hash).slice(1),
             shown: document.querySelector('#exDetail code').textContent };`);
  check("the address bar says which node you are on, in the one notation",
    addr.hash === addr.shown && /^[^,]+\/[^,]+,.*isMinResIterate$/.test(addr.hash),
    addr.hash || "nothing");

  const landed = await evaluate(`
    location.hash = '#Numlib/Eigen';
    await new Promise(r => setTimeout(r, 1200));
    ${SETTLE}
    return { title: document.querySelector('#exDetail h3').textContent,
             sel: [...document.querySelectorAll('#exSvg .ex-node.sel')]
               .map(e => e.getAttribute('aria-label')) };`);
  check("a link into the page lands on the node it names",
    landed.title === "Eigen" && landed.sel.length === 1
      && landed.sel[0].startsWith("Numlib/Eigen,"),
    `${landed.title}, outlined ${JSON.stringify(landed.sel)}`);

  /* --- the cone is followed over what really touches what ---
     A shut box stands for many declarations at once, so a walk over the graph between
     boxes can arrive at one by a declaration that is in the cone and leave it by a
     declaration that is not, and light whatever is past it for nothing. These two
     theorems are in the same module and touch none of each other's dependencies in
     either direction; what they share is that each touches a declaration in the same
     shut area, which is a path no dependency ever took. */
  const honest = await evaluate(`
    location.hash = '#Numlib/Krylov/Iterate,Krylov.IsMinResIterate.norm_residual_antitone';
    await new Promise(r => setTimeout(r, 1500));
    ${SETTLE}
    const at = (name) => [...document.querySelectorAll('#exSvg .ex-node.decl')]
      .find(e => e.getAttribute('aria-label').startsWith(name + ','));
    const f = at('Krylov.IsMinResIterate.norm_residual_antitone');
    const other = at('Krylov.IsMinResIterate.norm_residual_le_norm_aeval');
    const r = f && f.getBoundingClientRect();
    return {
      sel: !!f && f.classList.contains('sel'),
      drawn: !!other,
      dim: !!other && other.classList.contains('dim'),
      shut: document.querySelectorAll('#exSvg .ex-node.grp:not(.open):not(.dim)').length,
      at: r && [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)],
    };`);
  check("a box the focused one does not touch is dimmed",
    honest.sel && honest.drawn && honest.dim,
    honest.drawn ? (honest.dim ? "dimmed" : "lit through a shut box") : "not on the canvas");
  check("a shut box holding something in the cone still stands in for it",
    honest.shut > 0, `${honest.shut} lit shut boxes`);

  /* --- and clicking what is already focused puts the drawing back to itself --- */
  await clickAt(...honest.at);
  const off = await evaluate(`return {
    sel: document.querySelectorAll('#exSvg .ex-node.sel').length,
    dim: document.querySelectorAll('#exSvg .ex-node.dim').length,
    focused: document.getElementById('exSvg').classList.contains('focused'),
    detail: !!document.querySelector('#exDetail h3') };`);
  check("clicking the focused box defocuses it",
    !off.sel && !off.dim && !off.focused, `${off.sel} outlined, ${off.dim} dimmed`);

  /* --- a declaration carries the same control, doing what a declaration opens into ---
     One control, in one place, doing the one thing the box it is on can be opened into:
     a group into the boxes it holds, a declaration into the neighbourhood it sits in.
     That neighbourhood used to be reachable by a double-click and by nothing else. */
  const nb = await evaluate(`
    const d = [...document.querySelectorAll('#exSvg .ex-node.decl')]
      .find(e => e.getAttribute('aria-label')
        .startsWith('Krylov.IsMinResIterate.norm_residual_antitone,'));
    const box = d.querySelector(':scope > .ex-box').getBoundingClientRect();
    const c = d.querySelector(':scope > .ex-toggle rect').getBoundingClientRect();
    return { off: Math.round(c.x - box.x),
             label: d.querySelector(':scope > .ex-toggle').getAttribute('aria-label'),
             at: [Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2)] };`);
  check("a declaration carries one too, at the same edge",
    nb.off <= 1 && /^Draw the neighbourhood of /.test(nb.label),
    `${nb.off}px in, "${nb.label}"`);

  await clickAt(...nb.at);
  const drew = await evaluate(`
    for (let i = 0; i < 80 && !document.getElementById('exConeBar'); i++)
      await new Promise(r => setTimeout(r, 100));
    ${SETTLE}
    return { bar: !!document.getElementById('exConeBar'),
             of: (document.getElementById('exConeOf') || {}).textContent || '',
             decls: document.querySelectorAll('#exSvg .ex-node.decl').length,
             groups: document.querySelectorAll('#exSvg .ex-node.grp').length };`);
  check("and it draws that neighbourhood, whole and on its own",
    drew.bar && drew.groups === 0 && drew.decls === 17,
    `${drew.decls} declarations, ${drew.groups} groups, of ${drew.of.trim()}`);

  /* back out to the whole graph, which comes back as it was left */
  await evaluate(`
    document.getElementById('exConeBack').click();
    for (let i = 0; i < 80 && document.getElementById('exConeBar'); i++)
      await new Promise(r => setTimeout(r, 100));
    ${SETTLE} return 1;`);

  /* --- the panes float over the drawing, and are dragged wider by their grip --- */
  const gw = await evaluate("return document.getElementById('exSide').getBoundingClientRect().width");
  const grip = await evaluate(
    "const r = document.querySelectorAll('[role=\\'separator\\']')[0].getBoundingClientRect();" +
    "return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]");
  await dragBy(grip[0], grip[1], 90, 0);
  await evaluate("await new Promise(r=>setTimeout(r,200)); return 1");
  const gw2 = await evaluate("return document.getElementById('exSide').getBoundingClientRect().width");
  const vb = await evaluate("return document.getElementById('exSvg').getAttribute('viewBox')");
  const vw = await evaluate("return document.getElementById('exViewport').clientWidth");
  check("dragging its grip resizes the pane", Math.abs(gw2 - gw - 90) < 8, `${gw} → ${gw2}`);
  check("the canvas is as wide as its own element", vb.split(" ")[2] === String(vw), `${vb} vs ${vw}`);

  /* --- the drawing runs under the panes, and folding one uncovers it ---
     A pane is over the drawing rather than beside it, so the canvas is the whole width
     however many panes are open, and folding one neither resizes nor redraws it. */
  const fold = await evaluate(`
    const box = () => document.getElementById('exViewport').getBoundingClientRect();
    const side = document.getElementById('exSide').getBoundingClientRect();
    const under = box().x <= side.x + 1 && box().right >= side.right - 1;
    const before = document.getElementById('exSvg').getAttribute('viewBox');
    document.getElementById('exFoldIndex').click();
    await new Promise(r => setTimeout(r, 500));
    return { under, before, after: document.getElementById('exSvg').getAttribute('viewBox'),
             hidden: getComputedStyle(document.getElementById('exSide')).visibility };`);
  check("the drawing runs under a pane, and folding one leaves it alone",
    fold.under && fold.hidden === "hidden" && fold.before === fold.after,
    `${fold.before} throughout, index ${fold.hidden}`);
  await evaluate("document.getElementById('exFoldIndex').click();"
    + " await new Promise(r => setTimeout(r, 400)); return 1;");

  /* --- zoom buttons --- */
  const z0 = await evaluate("return document.getElementById('exZoomLab').textContent");
  await evaluate("document.getElementById('exZoomIn').click(); await new Promise(r=>setTimeout(r,120)); return 1");
  const z1 = await evaluate("return document.getElementById('exZoomLab').textContent");
  check("zoom in changes the scale", z0 !== z1, `${z0} → ${z1}`);

  /* --- the progress bar ---
     One hue in two strengths: the bar is the hue, the ground under it is the same hue
     let down to a tint, so the two are never the same colour. */
  const prog = await evaluate(`
    const g = [...document.querySelectorAll('#exSvg .ex-node.grp')]
      .find(e => e.getAttribute('aria-label').startsWith('Numlib/Eigen,'));
    const box = g.querySelector(':scope > .ex-box');
    const p = g.querySelector(':scope > .ex-prog');
    return { h: +box.getAttribute('height'), ph: +p.getAttribute('height'), py: +p.getAttribute('y'),
             pw: +p.getAttribute('width'), bw: +box.getAttribute('width'),
             clip: !!p.getAttribute('clip-path'), fill: p.getAttribute('fill'),
             ground: g.querySelector(':scope > .ex-fill').getAttribute('fill') };`);
  check("progress fills the box height, clipped by it, in the box's own colour",
    prog.ph === prog.h && prog.py === 0 && prog.clip && prog.pw <= prog.bw
      && /^hsl\(/.test(prog.fill) && prog.fill !== prog.ground,
    `${prog.pw.toFixed(1)}/${prog.bw} wide, ${prog.ph}/${prog.h} tall, ${prog.fill} on ${prog.ground}`);

  /* --- the whole project at declaration depth still has its edges ---
     A scene must never be parked in $state, which deep-proxies every node in it; the
     canvas then writes its edge layers onto one identity and the edge records read
     another, and the draw comes out with nodes and no edges at all. */
  const past = await evaluate(`
    const hit = (t) => [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === t);
    /* how far to open the tree is asked for in the canvas's own right-click menu */
    document.getElementById('exViewport').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 600, clientY: 400 }));
    await new Promise(r => setTimeout(r, 120));
    const menu = !!document.getElementById('exMenu');
    hit('Declarations').click();
    await new Promise(r => setTimeout(r, 1500));
    /* thousands of boxes take ELK a while and the draw after it a while again; wait
       for the page to say it is done rather than guess how long that is */
    for (let i = 0; i < 200; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (i && !document.getElementById('exBusy')) break;
    }
    ${SETTLE}
    return { menu, shut: !document.getElementById('exMenu'),
             nodes: document.querySelectorAll('#exSvg .ex-node').length,
             edges: document.querySelectorAll('#exSvg .ex-edge').length };`);
  check("right-click opens the menu, and picking from it closes it",
    past.menu && past.shut, past.menu ? "opened and shut" : "never opened");
  check("the whole project at declaration depth has its edges",
    past.nodes > 1000 && past.edges > 1000,
    `${past.nodes} nodes, ${past.edges} edges`);

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
