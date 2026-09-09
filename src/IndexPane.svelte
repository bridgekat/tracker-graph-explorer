<!-- The index: a search over every group and declaration, the state and kind filters,
     and the plan's tree. Picking anything here selects it and opens the canvas to it. -->
<script>
  import { app, filtering, rebuild, select, toggleGroup } from "./lib/state.svelte.js";
  import { STATE_LABEL, fmt, plural, hueBar } from "./lib/util.js";
  import * as TD from "./lib/derive.js";

  const LIST_CAP = 400;
  let query = $state("");
  let timer;
  function onInput(e) {
    clearTimeout(timer);
    const v = e.currentTarget.value;
    timer = setTimeout(() => { query = v.trim(); }, 130);
  }

  const keep = (d) => {
    const dd = app.base.decl[d];
    if (!app.states.has(dd.state)) return false;
    if (app.kinds && !app.kinds.has(dd.kind)) return false;
    return true;
  };

  /* the tree, flattened to the rows that are actually open */
  const rows = $derived.by(() => {
    if (!app.base || query) return [];
    const out = [];
    const walk = (gi) => {
      const t = app.base.tree[gi];
      if (!t.sub) return;
      out.push({ kind: "group", t });
      if (!app.open.has(gi)) return;
      if (t.kids.length) { t.kids.forEach(walk); return; }
      t.decls.forEach((d) => {
        if (filtering() && !keep(d)) return;
        out.push({ kind: "decl", d: app.base.decl[d], level: t.level + 1 });
      });
    };
    app.base.treeRoots.forEach(walk);
    return out;
  });

  const hits = $derived.by(() => {
    if (!app.base || !query) return null;
    const q = query.toLowerCase();
    const groups = [];
    for (let i = 0; i < app.base.tree.length && groups.length < 40; i++) {
      const t = app.base.tree[i];
      if (t.sub && t.name.toLowerCase().includes(q)) groups.push({ kind: "group", t });
    }
    const decls = [];
    for (let i = 0; i < app.base.decl.length; i++) {
      const d = app.base.decl[i];
      if (filtering() && !keep(i)) continue;
      const p = d.id.toLowerCase().indexOf(q);
      if (p >= 0) decls.push({ d, rank: (d.label.toLowerCase().includes(q) ? 0 : 1) * 1000 + p });
    }
    decls.sort((a, b) => a.rank - b.rank || a.d.id.length - b.d.id.length);
    const total = groups.length + decls.length;
    const shown = groups.concat(
      decls.slice(0, Math.max(0, LIST_CAP - groups.length)).map((x) => ({ kind: "hit", d: x.d })));
    return { shown, total };
  });

  const meta = $derived.by(() => {
    if (!app.base) return "";
    if (hits) {
      return hits.total > hits.shown.length
        ? `${fmt(hits.shown.length)} of ${fmt(hits.total)} matches shown`
        : plural(hits.total, "match", "matches");
    }
    return `${fmt(rows.length)} rows · ${fmt(app.base.meta.nodes)} results in `
      + `${fmt(app.base.meta.modules)} modules`;
  });

  const isSel = (t, i) => !!app.sel && app.sel.t === t && app.sel.i === i;

  /* the chips: a state or a kind switched off is one the canvas leaves out */
  function toggleState(s) {
    if (app.states.has(s)) app.states.delete(s); else app.states.add(s);
    if (!app.states.size) TD.STATES.forEach((z) => { if (app.base.meta.states[z]) app.states.add(z); });
    rebuild({ anchor: app.sel });
  }
  let liveKinds = $state(null);
  function toggleKind(k, all) {
    liveKinds ??= new Set(all);
    if (liveKinds.has(k)) liveKinds.delete(k); else liveKinds.add(k);
    if (!liveKinds.size) all.forEach((z) => liveKinds.add(z));
    app.kinds = liveKinds.size === all.length ? null : new Set(liveKinds);
    rebuild({ anchor: app.sel });
  }
  const kindOn = (k, all) => !liveKinds || liveKinds.has(k);
</script>

<div class="ex-pane-b">
  <input id="exSearch" type="search" placeholder="Search a group or a declaration"
    autocomplete="off" aria-label="Search a group or a declaration" oninput={onInput} />

  <div class="ex-filters" id="exFilters" role="group" aria-label="Filter by state and kind">
    {#if app.base}
      {#each TD.STATES.filter((s) => app.base.meta.states[s] > 0) as s}
        <button class="fchip" aria-pressed={app.states.has(s)} onclick={() => toggleState(s)}>
          <i class="sdot" style="background: var(--st-{s})"></i>
          {STATE_LABEL[s]} {fmt(app.base.meta.states[s])}
        </button>
      {/each}
      {@const kinds = Object.keys(app.base.meta.kinds)}
      {#if kinds.length > 1}
        <span class="fsep"></span>
        {#each kinds as k}
          <button class="fchip" aria-pressed={kindOn(k, kinds)} onclick={() => toggleKind(k, kinds)}>
            <i class="sdot" style="background: var(--ink3)"></i>
            {k}s {fmt(app.base.meta.kinds[k])}
          </button>
        {/each}
      {/if}
    {/if}
  </div>

  <div class="ex-meta" id="exIndexMeta">{meta}</div>

  <div class="ex-tree" id="exTree">
    {#if hits}
      {#each hits.shown as row}
        {#if row.kind === "group"}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="tw" onclick={() => select({ t: 0, i: row.t.i }, true)}
            role="button" tabindex="-1" onkeydown={() => {}}>
            <i class="sdot" style="background: var(--st-{row.t.state})" title={STATE_LABEL[row.t.state]}></i>
            <span class="tw-nm">{row.t.short}</span>
            <span class="tw-k">group</span>
          </div>
        {:else}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="tw" onclick={() => select({ t: 1, i: row.d.i }, true)}
            role="button" tabindex="-1" onkeydown={() => {}}>
            <i class="sdot" style="background: var(--st-{row.d.state})" title={STATE_LABEL[row.d.state]}></i>
            <span class="tw-nm mono" title={row.d.id}>{row.d.id}</span>
          </div>
        {/if}
      {/each}
      {#if !hits.total}
        <div class="tw-none">Nothing matches “{query}”.</div>
      {/if}
    {:else}
      {#each rows as row (row.kind === "group" ? "g" + row.t.i : "d" + row.d.i)}
        {#if row.kind === "group"}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="tw" class:on={isSel(0, row.t.i)} style="padding-left: {5 + row.t.level * 13}px"
            onclick={() => select({ t: 0, i: row.t.i }, true)} role="button" tabindex="-1" onkeydown={() => {}}>
            <button class="tw-car" class:open={app.open.has(row.t.i)}
              aria-expanded={app.open.has(row.t.i)}
              aria-label={(app.open.has(row.t.i) ? "Collapse " : "Expand ") + row.t.name}
              onclick={(e) => { e.stopPropagation(); toggleGroup(row.t.i); }}>
              <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
                <path d="M3 1.5 6.2 4.5 3 7.5" fill="none" stroke="currentColor"
                  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <i class="sdot" style="background: var(--st-{row.t.state})" title={STATE_LABEL[row.t.state]}></i>
            <span class="tw-nm" title={row.t.name}>{row.t.label}</span>
            {#if row.t.ready && !row.t.done}<span class="tw-tagr">ready</span>{/if}
            <span class="tw-n">{fmt(row.t.sub)}</span>
            <span class="tw-bar" title="{fmt(row.t.byState.proved)} of {fmt(row.t.sub)} proved">
              <i style="width: {(row.t.sub ? row.t.byState.proved / row.t.sub * 100 : 0).toFixed(1)}%;
                        background: {hueBar(row.t.hue, row.t.tone)}"></i>
            </span>
          </div>
        {:else}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="tw tw-d" class:on={isSel(1, row.d.i)}
            style="padding-left: {5 + row.level * 13 + 15}px"
            onclick={() => select({ t: 1, i: row.d.i }, true)} role="button" tabindex="-1" onkeydown={() => {}}>
            <i class="sdot" style="background: var(--st-{row.d.state})" title={STATE_LABEL[row.d.state]}></i>
            <span class="tw-nm mono" title={row.d.id}>{row.d.label}</span>
            <span class="tw-k">{row.d.kind === "definition" ? "def" : "thm"}</span>
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>
