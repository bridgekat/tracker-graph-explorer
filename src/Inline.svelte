<!-- One level of a Markdown inline token stream. Everything reaches the page as text
     in a template; only math tokens let KaTeX generate markup. -->
<script>
  import { math } from "./lib/math.js";
  import Inline from "./Inline.svelte";
  let { tokens = [] } = $props();
</script>

{#each tokens as t}
  {#if t.type === "text" || t.type === "escape"}
    {#if t.tokens?.length}<Inline tokens={t.tokens} />{:else}{t.text}{/if}
  {:else if t.type === "inlineKatex"}<span use:math={t}></span>
  {:else if t.type === "codespan"}<code>{t.text}</code>
  {:else if t.type === "strong"}<b><Inline tokens={t.tokens} /></b>
  {:else if t.type === "em"}<i><Inline tokens={t.tokens} /></i>
  {:else if t.type === "del"}<s><Inline tokens={t.tokens} /></s>
  {:else if t.type === "br"}<br />
  {:else if t.type === "link" || t.type === "image"}
    <!-- a viewer of someone else's graph should not become a way to navigate
         somewhere, so a link contributes its words and not its href -->
    {#if t.tokens?.length}<Inline tokens={t.tokens} />{:else}{t.text ?? ""}{/if}
  {:else}{t.raw ?? t.text ?? ""}{/if}
{/each}
