<!-- Whatever is selected, in full: its state, where it lives, its doc comment, and the
     declarations it rests on and that rest on it — each one a way to go there. -->
<script>
  import { Badge, Button } from "flowbite-svelte";
  import Prose from "./Prose.svelte";
  import StateDot from "./StateDot.svelte";
  import { app, select } from "./lib/state.svelte.js";
  import { STATE_LABEL, fmt, plural } from "./lib/util.js";
  import { STATES } from "./lib/derive.js";

  const DEP_CAP = 60;
  const B = $derived(app.base);
  const group = $derived(app.sel?.t === 0 ? B.tree[app.sel.i] : null);
  const decl = $derived(app.sel?.t === 1 ? B.decl[app.sel.i] : null);
  const states = $derived(group ? STATES.filter((s) => group.byState[s]) : []);

  let copied = $state(false);
  function copy(id) {
    navigator.clipboard?.writeText(id);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  /* a state reads as its own colour, so the badge is tinted from the same token the
     canvas paints with rather than from Flowbite's palette */
  const stateStyle = (s) => `background: var(--nf-${s}); color: var(--ink)`;
  const H4 = "mt-4 mb-1.5 text-[11px] font-semibold tracking-wide text-gray-500 uppercase";
  const WARN = `${H4} !text-orange-700 dark:!text-orange-400`;
  const ROW =
    "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs " +
    "hover:bg-gray-100 dark:hover:bg-gray-800";
  const MONO = "font-mono text-[11px] break-all";
  const MUTED = "text-xs text-gray-500";
</script>

<div id="exDetail" class="min-h-0 flex-1 overflow-y-auto p-3">
  {#if !app.sel}
    <p class={MUTED}>
      Pick a box on the canvas, or an entry in the index, to read what it says and what it
      rests on.
    </p>
    {#if B.meta.rootDesc}
      <h4 class={H4}>About this plan</h4>
      <Prose text={B.meta.rootDesc.split(/\n#{2,}\s/)[0]} />
    {/if}
  {:else if group}
    <div class="mb-2 flex flex-wrap gap-1.5">
      <Badge color="gray">{group.isModule ? "module" : "group"}</Badge>
      <Badge style={stateStyle(group.state)}>{STATE_LABEL[group.state]}</Badge>
      {#if group.done}<Badge color="green">done</Badge>
      {:else if group.ready}<Badge color="yellow">ready to work on</Badge>{/if}
    </div>
    <h3 class="text-base font-semibold text-gray-950 dark:text-white">{group.label}</h3>
    <div class="mt-1 {MONO} text-gray-500">module {group.name.split("/").join(".")}</div>

    <div class="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      {#each states as s}
        <i
          style="background: var(--st-{s}); width: {((group.byState[s] / group.sub) * 100).toFixed(2)}%"
          title="{fmt(group.byState[s])} {STATE_LABEL[s]}"
        ></i>
      {/each}
    </div>
    <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-700 dark:text-gray-300">
      {#each states as s}
        <span class="flex items-center gap-1.5">
          <StateDot state={s} />
          <b class="text-gray-950 tabular-nums dark:text-white">{fmt(group.byState[s])}</b>
          {STATE_LABEL[s]}
        </span>
      {/each}
    </div>

    {#if group.desc}
      <h4 class={H4}>What it is for</h4>
      <Prose text={group.desc} />
    {/if}

    {#if group.kids.length}
      <h4 class={H4}>{plural(group.kids.length, "child group")}</h4>
      <div class="flex flex-col">
        {#each group.kids as k}
          <button class={ROW} onclick={() => select({ t: 0, i: k }, true)}>
            <StateDot state={B.tree[k].state} />
            <span class="truncate">{B.tree[k].label}</span>
            <span class="ms-auto shrink-0 font-mono text-[10px] tabular-nums text-gray-500">
              {fmt(B.tree[k].sub)}
            </span>
          </button>
        {/each}
      </div>
    {:else if group.decls.length}
      <h4 class={H4}>{plural(group.decls.length, "declaration")}</h4>
      {@render list(group.decls)}
    {/if}
  {:else}
    <div class="mb-2 flex flex-wrap gap-1.5">
      <Badge color="gray">{decl.kind}</Badge>
      <Badge style={stateStyle(decl.state)}>{STATE_LABEL[decl.state]}</Badge>
      {#if decl.deprecated}<Badge color="red">deprecated</Badge>{/if}
    </div>
    <h3 class="{MONO} text-base font-semibold text-gray-950 dark:text-white">{decl.label}</h3>
    <button
      class="mt-1 {MONO} text-left text-gray-500 hover:underline"
      onclick={() => select({ t: 0, i: decl.g }, true)}
    >
      module {B.tree[decl.g].name.split("/").join(".")}
    </button>

    <div
      class="mt-2 flex items-start gap-2 rounded border border-gray-200 bg-gray-100 p-2
             dark:border-gray-800 dark:bg-gray-800"
    >
      <code class="min-w-0 flex-1 {MONO} text-gray-700 dark:text-gray-300">{decl.id}</code>
      <Button
        size="xs"
        color="alternative"
        class="shrink-0 !px-2 !py-1 !text-[10px]"
        onclick={() => copy(decl.id)}>{copied ? "copied" : "copy"}</Button
      >
    </div>
    <Button
      size="xs"
      color="alternative"
      class="mt-3"
      onclick={() => {
        app.mode = "tree";
        select({ t: 1, i: decl.i }, true);
      }}>Show in the graph</Button
    >

    {#if decl.wrong}
      <h4 class={WARN}>Marked wrong</h4>
      <Prose text={decl.wrong} />
    {/if}
    {#if decl.deprecated}
      <h4 class={WARN}>Deprecated</h4>
      <Prose text={decl.deprecated} />
    {/if}
    {#if decl.desc}
      <h4 class={H4}>Statement</h4>
      <Prose text={decl.desc} />
    {/if}
    {#if decl.source}
      <h4 class={H4}>Source</h4>
      <p class="{MONO} text-gray-700 dark:text-gray-300">{decl.source}</p>
    {/if}

    <h4 class={H4}>Rests on {plural(B.dout[decl.i].length, "declaration")}</h4>
    {#if B.dout[decl.i].length}
      {@render list(B.dout[decl.i])}
    {:else}
      <p class={MUTED}>Nothing in the plan; it stands on the ambient library alone.</p>
    {/if}

    <h4 class={H4}>{plural(B.din[decl.i].length, "declaration")} rest on it</h4>
    {#if B.din[decl.i].length}
      {@render list(B.din[decl.i])}
    {:else}
      <p class={MUTED}>Nothing tracked uses it yet.</p>
    {/if}
  {/if}
</div>

{#snippet list(items)}
  <div class="flex flex-col">
    {#each items.slice(0, DEP_CAP) as di}
      <button class={ROW} onclick={() => select({ t: 1, i: di }, true)}>
        <StateDot state={B.decl[di].state} />
        <span class="truncate font-mono" title={B.decl[di].id}>{B.decl[di].label}</span>
        <span class="ms-auto shrink-0 truncate text-[10px] text-gray-500">
          {B.tree[B.decl[di].g].label}
        </span>
      </button>
    {/each}
    {#if items.length > DEP_CAP}
      <div class="px-1.5 py-1 text-[11px] text-gray-500">
        and {fmt(items.length - DEP_CAP)} more
      </div>
    {/if}
  </div>
{/snippet}
