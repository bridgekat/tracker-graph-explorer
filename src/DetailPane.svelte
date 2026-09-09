<!-- Whatever is selected, in full: its state, where it lives, its doc comment, and the
     declarations it rests on and that rest on it — each one a way to go there. -->
<script>
  import Prose from "./Prose.svelte";
  import { app, openAllUnder, select, setCone, toggleGroup } from "./lib/state.svelte.js";
  import { STATE_LABEL, fmt, plural } from "./lib/util.js";
  import * as TD from "./lib/derive.js";

  const DEP_CAP = 60;
  const B = $derived(app.base);
  const group = $derived(app.sel && app.sel.t === 0 ? B.tree[app.sel.i] : null);
  const decl = $derived(app.sel && app.sel.t === 1 ? B.decl[app.sel.i] : null);

  const path = $derived.by(() => {
    if (!group) return [];
    const out = [];
    let cur = group.parent;
    while (cur !== null) { out.unshift(cur); cur = B.tree[cur].parent; }
    return out;
  });

  let copied = $state(false);
  function copy(id) {
    navigator.clipboard?.writeText(id);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }
</script>

<div class="ex-pane-b" id="exDetail">
  {#if !app.sel}
    <p class="muted">Pick a box on the canvas, or an entry in the index, to read what it
      says and what it rests on.</p>
    {#if B?.meta.rootDesc}
      <h4>About this plan</h4>
      <Prose text={B.meta.rootDesc.split(/\n#{2,}\s/)[0]} />
    {/if}

  {:else if group}
    <div class="d-head">
      <span class="chip k">{group.isModule ? "module" : "group"}</span>
      <span class="chip s-{group.state}">{STATE_LABEL[group.state]}</span>
      {#if group.done}<span class="chip ok">done</span>{/if}
      {#if group.ready && !group.done}<span class="chip rdy">ready to work on</span>{/if}
    </div>
    <h3>{group.label}</h3>
    {#if path.length}
      <div class="crumb">
        {#each path as gi, k}
          {#if k}<span class="sep">/</span>{/if}
          <button class="crumb-b" onclick={() => select({ t: 0, i: gi }, true)}>{B.tree[gi].label}</button>
        {/each}
        <span class="sep">/</span><span>{group.label}</span>
      </div>
    {/if}
    <div class="d-mod">module {group.name.split("/").join(".")}</div>

    <div class="d-counts">
      <div class="d-bar">
        {#each TD.STATES.filter((s) => group.byState[s]) as s}
          <i style="background: var(--st-{s}); width: {(group.byState[s] / group.sub * 100).toFixed(2)}%"
            title="{fmt(group.byState[s])} {STATE_LABEL[s]}"></i>
        {/each}
      </div>
      <div class="d-lg">
        {#each TD.STATES.filter((s) => group.byState[s]) as s}
          <span class="lgi">
            <i class="sdot" style="background: var(--st-{s})"></i>
            <b>{fmt(group.byState[s])}</b> {STATE_LABEL[s]}
          </span>
        {/each}
      </div>
    </div>

    <div class="d-act">
      <button onclick={() => toggleGroup(group.i)}>
        {app.open.has(group.i) ? "Close it" : group.isModule ? "Show its declarations" : "Open this group"}
      </button>
      {#if !group.isModule}
        <button onclick={() => openAllUnder(group.i)}>Open all the way down</button>
      {/if}
      <button onclick={() => setCone({ t: 0, i: group.i })}>Neighbourhood</button>
    </div>

    {#if group.desc}
      <h4>What it is for</h4>
      <Prose text={group.desc} />
    {/if}

    {#if group.kids.length}
      <h4>{plural(group.kids.length, "child group")}</h4>
      <div class="d-list">
        {#each group.kids as k}
          <button class="d-row" onclick={() => select({ t: 0, i: k }, true)}>
            <i class="sdot" style="background: var(--st-{B.tree[k].state})"></i>
            <span class="d-nm">{B.tree[k].label}</span>
            <span class="d-n">{fmt(B.tree[k].sub)}</span>
          </button>
        {/each}
      </div>
    {:else if group.decls.length}
      <h4>{plural(group.decls.length, "declaration")}</h4>
      {@render list(group.decls)}
    {/if}

  {:else}
    <div class="d-head">
      <span class="chip k">{decl.kind}</span>
      <span class="chip s-{decl.state}">{STATE_LABEL[decl.state]}</span>
      {#if decl.deprecated}<span class="chip warn">deprecated</span>{/if}
    </div>
    <h3 class="mono">{decl.label}</h3>
    <div class="crumb">
      {#each decl.path as gi, k}
        {#if k}<span class="sep">/</span>{/if}
        <button class="crumb-b" onclick={() => select({ t: 0, i: gi }, true)}>{B.tree[gi].label}</button>
      {/each}
    </div>
    <div class="d-id">
      <code>{decl.id}</code>
      <button class="d-copy" onclick={() => copy(decl.id)}>{copied ? "copied" : "copy"}</button>
    </div>

    <div class="d-act">
      <button onclick={() => setCone({ t: 1, i: decl.i })}>Neighbourhood</button>
      <button onclick={() => { app.mode = "tree"; select({ t: 1, i: decl.i }, true); }}>Show in the graph</button>
    </div>

    {#if decl.wrong}<h4 class="bad">Marked wrong</h4><Prose text={decl.wrong} />{/if}
    {#if decl.deprecated}<h4 class="bad">Deprecated</h4><Prose text={decl.deprecated} />{/if}
    {#if decl.desc}<h4>Statement</h4><Prose text={decl.desc} />{/if}
    {#if decl.source}<h4>Source</h4><p class="d-src">{decl.source}</p>{/if}

    <h4>Rests on {plural(B.dout[decl.i].length, "declaration")}</h4>
    {#if B.dout[decl.i].length}
      {@render list(B.dout[decl.i])}
    {:else}
      <p class="muted">Nothing in the plan; it stands on the ambient library alone.</p>
    {/if}

    <h4>{plural(B.din[decl.i].length, "declaration")} rest on it</h4>
    {#if B.din[decl.i].length}
      {@render list(B.din[decl.i])}
    {:else}
      <p class="muted">Nothing tracked uses it yet.</p>
    {/if}
  {/if}
</div>

{#snippet list(items)}
  <div class="d-list">
    {#each items.slice(0, DEP_CAP) as di}
      <button class="d-row" onclick={() => select({ t: 1, i: di }, true)}>
        <i class="sdot" style="background: var(--st-{B.decl[di].state})"></i>
        <span class="d-nm mono" title={B.decl[di].id}>{B.decl[di].label}</span>
        <span class="d-g">{B.tree[B.decl[di].g].label}</span>
      </button>
    {/each}
    {#if items.length > DEP_CAP}
      <div class="d-more">and {fmt(items.length - DEP_CAP)} more</div>
    {/if}
  </div>
{/snippet}
