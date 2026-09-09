<!-- A Lean doc comment. It is Markdown, and the interesting half of one is usually
     inside a code span — a norm or an operator in backticks inside bold — so it is
     worth parsing properly rather than approximately. marked does the parsing; this
     renders its tokens, which keeps everything text rather than markup. -->
<script>
  import { marked } from "marked";
  import Inline from "./Inline.svelte";
  import Prose from "./Prose.svelte";

  let { text = "", tokens = null, first = false } = $props();

  const blocks = $derived(tokens ?? (text ? lex(String(text)) : []));
  function lex(s) {
    try {
      return marked.lexer(s);
    } catch {
      return [{ type: "paragraph", tokens: [{ type: "text", text: s }] }];
    }
  }
  /* a loose list item holds blocks; a tight one holds inline tokens */
  const loose = (item) =>
    (item.tokens ?? []).some(
      (x) => x.type === "paragraph" || x.type === "list" || x.type === "code",
    );
</script>

<div class="prose" class:first>
  {#each blocks as t}
    {#if t.type === "space"}
      <!-- nothing -->
    {:else if t.type === "paragraph"}
      <p><Inline tokens={t.tokens} /></p>
    {:else if t.type === "heading"}
      <p class="ph"><Inline tokens={t.tokens} /></p>
    {:else if t.type === "code"}
      <pre><code>{t.text}</code></pre>
    {:else if t.type === "blockquote"}
      <blockquote><Prose tokens={t.tokens} /></blockquote>
    {:else if t.type === "hr"}
      <hr />
    {:else if t.type === "list"}
      <svelte:element
        this={t.ordered ? "ol" : "ul"}
        start={t.ordered && t.start > 1 ? t.start : undefined}
      >
        {#each t.items as item}
          <li>
            {#if loose(item)}<Prose tokens={item.tokens} />{:else}<Inline
                tokens={item.tokens}
              />{/if}
          </li>
        {/each}
      </svelte:element>
    {:else if t.type === "table"}
      <table>
        <thead>
          <tr
            >{#each t.header as c}<th><Inline tokens={c.tokens} /></th
              >{/each}</tr
          >
        </thead>
        <tbody>
          {#each t.rows as row}
            <tr
              >{#each row as c}<td><Inline tokens={c.tokens} /></td>{/each}</tr
            >
          {/each}
        </tbody>
      </table>
    {:else if t.type === "text"}
      <p>
        {#if t.tokens?.length}<Inline tokens={t.tokens} />{:else}{t.text}{/if}
      </p>
    {:else}
      <p>{t.raw ?? t.text ?? ""}</p>
    {/if}
  {/each}
</div>
