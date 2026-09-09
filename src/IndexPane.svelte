<!-- The index: a search over every group and declaration, and the plan's tree.
     Picking anything here selects it and opens the canvas to it. -->
<script>
  import { Search } from "flowbite-svelte";
  import StateDot from "./StateDot.svelte";
  import { app, select, toggleGroup } from "./lib/state.svelte.js";
  import { fmt, plural, hueBar } from "./lib/util.js";

  const LIST_CAP = 400;
  let query = $state("");
  let timer;
  function onInput(e) {
    clearTimeout(timer);
    const v = e.currentTarget.value;
    timer = setTimeout(() => {
      query = v.trim();
    }, 130);
  }

  /* the tree, flattened to the rows that are actually open */
  const rows = $derived.by(() => {
    if (!app.base || query) return [];
    const out = [];
    const walk = (gi) => {
      const t = app.base.tree[gi];
      if (!t.sub) return;
      out.push({ t });
      if (!app.open.has(gi)) return;
      if (t.kids.length) t.kids.forEach(walk);
      else t.decls.forEach((d) => out.push({ d: app.base.decl[d], level: t.level + 1 }));
    };
    app.base.treeRoots.forEach(walk);
    return out;
  });

  /* what matches: groups by name, then declarations by id, the closest match first */
  const hits = $derived.by(() => {
    if (!app.base || !query) return null;
    const q = query.toLowerCase();
    const groups = app.base.tree
      .filter((t) => t.sub && t.name.toLowerCase().includes(q))
      .slice(0, 40);
    const decls = [];
    for (const d of app.base.decl) {
      const p = d.id.toLowerCase().indexOf(q);
      if (p >= 0) decls.push({ d, rank: (d.label.toLowerCase().includes(q) ? 0 : 1) * 1000 + p });
    }
    decls.sort((a, b) => a.rank - b.rank || a.d.id.length - b.d.id.length);
    return {
      groups,
      decls: decls.slice(0, Math.max(0, LIST_CAP - groups.length)).map((x) => x.d),
      total: groups.length + decls.length,
    };
  });

  const meta = $derived.by(() => {
    if (!app.base) return "";
    if (hits) {
      const shown = hits.groups.length + hits.decls.length;
      return shown < hits.total
        ? `${fmt(shown)} of ${fmt(hits.total)} matches shown`
        : plural(hits.total, "match", "matches");
    }
    return (
      `${fmt(rows.length)} rows · ${fmt(app.base.meta.nodes)} results in ` +
      `${fmt(app.base.meta.modules)} modules`
    );
  });

  const isSel = (t, i) => app.sel?.t === t && app.sel.i === i;

  const ROW = "tw flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pe-2 text-left text-xs";
  const HOVER = "hover:bg-gray-100 dark:hover:bg-gray-800";
  const SEL = "bg-gray-100 dark:bg-gray-800";
  const KIND = "ms-auto shrink-0 text-[10px] text-gray-500";
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="shrink-0 border-b border-gray-200 p-2 dark:border-gray-800">
    <Search
      id="exSearch"
      size="sm"
      placeholder="Search a group or a declaration"
      autocomplete="off"
      aria-label="Search a group or a declaration"
      oninput={onInput}
      class="py-1.5 text-xs"
    />
  </div>

  <div id="exIndexMeta" class="shrink-0 px-2 py-1.5 text-[10.5px] text-gray-500">{meta}</div>

  <div id="exTree" class="min-h-0 flex-1 overflow-y-auto pb-2">
    {#if hits}
      {#each hits.groups as t}
        <button
          class="{ROW} {HOVER} w-full"
          style="padding-left: 5px"
          onclick={() => select({ t: 0, i: t.i }, true)}
        >
          <StateDot state={t.state} />
          <span class="truncate">{t.short}</span>
          <span class={KIND}>group</span>
        </button>
      {/each}
      {#each hits.decls as d}
        <button
          class="{ROW} {HOVER} w-full"
          style="padding-left: 5px"
          onclick={() => select({ t: 1, i: d.i }, true)}
        >
          <StateDot state={d.state} />
          <span class="truncate font-mono" title={d.id}>{d.id}</span>
        </button>
      {/each}
      {#if !hits.total}
        <div class="p-3 text-xs text-gray-500">Nothing matches “{query}”.</div>
      {/if}
    {:else}
      {#each rows as row (row.t ? "g" + row.t.i : "d" + row.d.i)}
        {#if row.t}
          <!-- two buttons side by side, so neither is nested in the other: the chevron
               opens the group, the rest of the row selects it -->
          <div
            class="flex items-center {HOVER} {isSel(0, row.t.i) ? SEL : ''}"
            style="padding-left: {5 + row.t.level * 13}px"
          >
            <button
              class="shrink-0 rounded p-0.5 text-gray-500 hover:text-gray-950 dark:hover:text-white"
              aria-expanded={app.open.has(row.t.i)}
              aria-label={(app.open.has(row.t.i) ? "Collapse " : "Expand ") + row.t.name}
              onclick={() => toggleGroup(row.t.i)}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 9 9"
                aria-hidden="true"
                class="transition-transform {app.open.has(row.t.i) ? 'rotate-90' : ''}"
              >
                <path
                  d="M3 1.5 6.2 4.5 3 7.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <button class={ROW} title={row.t.name} onclick={() => select({ t: 0, i: row.t.i }, true)}>
              <StateDot state={row.t.state} />
              <span class="truncate">{row.t.label}</span>
              {#if row.t.ready && !row.t.done}
                <span
                  class="shrink-0 rounded-sm bg-gray-100 px-1 text-[9.5px] text-gray-500 uppercase
                         dark:bg-gray-800">ready</span
                >
              {/if}
              <span class="{KIND} font-mono tabular-nums">{fmt(row.t.sub)}</span>
              <span
                class="h-1 w-9 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
                title="{fmt(row.t.byState.proved)} of {fmt(row.t.sub)} proved"
              >
                <i
                  class="block h-full"
                  style="width: {((row.t.byState.proved / row.t.sub) * 100).toFixed(1)}%;
                         background: {hueBar(row.t.hue, row.t.tone)}"
                ></i>
              </span>
            </button>
          </div>
        {:else}
          <button
            class="{ROW} {HOVER} w-full {isSel(1, row.d.i) ? SEL : ''}"
            style="padding-left: {20 + row.level * 13}px"
            onclick={() => select({ t: 1, i: row.d.i }, true)}
          >
            <StateDot state={row.d.state} />
            <span class="truncate font-mono" title={row.d.id}>{row.d.label}</span>
            <span class={KIND}>{row.d.kind === "definition" ? "def" : "thm"}</span>
          </button>
        {/if}
      {/each}
    {/if}
  </div>
</div>
