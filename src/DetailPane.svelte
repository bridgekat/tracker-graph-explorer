<!-- The selection's API documentation links, doc comment, and related nodes. -->
<script>
  import Prose from "./Prose.svelte";
  import StateDot from "./StateDot.svelte";
  import { declDocs, docsRoot, moduleDocs } from "./lib/site.js";
  import { app, select } from "./lib/state.svelte.js";
  import { fmt, plural } from "./lib/util.js";

  const DEP_CAP = 60;
  const B = $derived(app.base);
  const decl = $derived(app.sel?.t === 1 ? B.decl[app.sel.i] : null);
  const module = $derived(app.sel ? B.tree[decl ? decl.g : app.sel.i] : null);
  const desc = $derived(decl ? decl.desc : module?.desc);

  const H4 = "mt-4 mb-1.5 text-[11px] tracking-wide text-gray-500 uppercase";
  const ROW =
    "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs " +
    "hover:bg-gray-100 dark:hover:bg-gray-800";
  const MUTED = "text-xs text-gray-500";
  const LINK = "underline decoration-gray-400 underline-offset-2 hover:decoration-current";
  const EXT = { target: "_blank", rel: "noopener noreferrer" };
</script>

<div id="exDetail" class="min-h-0 flex-1 overflow-y-auto p-3">
  {#if !app.sel}
    <p class={MUTED}>
      Pick a box on the canvas, or an entry in the index, to read what it says and what it
      rests on.
    </p>
  {:else if module}
    <h3 class="text-base break-all text-gray-950 dark:text-white">
      {#if docsRoot && module.exists}
        <a class={LINK} href={moduleDocs(module.name)} {...EXT}>{module.name}</a>
      {:else}
        {module.name}
      {/if}
    </h3>
    {#if decl}
      <p class="mt-1 font-mono text-xs break-all text-gray-700 dark:text-gray-300">
        {#if docsRoot && decl.state !== "open"}
          <a class={LINK} href={declDocs(module.name, decl.id)} {...EXT}>{decl.id}</a>
        {:else}
          {decl.id}
        {/if}
      </p>
    {/if}
    {#if desc}
      <div class="mt-3"><Prose text={desc} /></div>
    {/if}

    {#if decl}
      <h4 class={H4}>Rests on {plural(B.dout[decl.i].length, "declaration")}</h4>
      {#if B.dout[decl.i].length}
        {@render list(B.dout[decl.i])}
      {:else}
        <p class={MUTED}>Nothing in the project; it stands on the ambient library alone.</p>
      {/if}

      <h4 class={H4}>{plural(B.din[decl.i].length, "declaration")} rest on it</h4>
      {#if B.din[decl.i].length}
        {@render list(B.din[decl.i])}
      {:else}
        <p class={MUTED}>Nothing in the project uses it yet.</p>
      {/if}
    {:else}
      {#if module.kids.length}
        <h4 class={H4}>{plural(module.kids.length, "module")} under it</h4>
        <div class="flex flex-col">
          {#each module.kids as k}
            <button class={ROW} onclick={() => select({ t: 0, i: k }, true)}>
              <StateDot state={B.tree[k].state} />
              <span class="truncate">{B.tree[k].label}</span>
              <span class="ms-auto shrink-0 font-mono text-[10px] tabular-nums text-gray-500">
                {fmt(B.tree[k].sub)}
              </span>
            </button>
          {/each}
        </div>
      {/if}
      {#if module.decls.length}
        <h4 class={H4}>{plural(module.decls.length, "declaration")} of its own</h4>
        {@render list(module.decls)}
      {/if}
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
