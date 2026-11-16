import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import katex from "katex";

// Tokenize math before Markdown can consume its backslashes and underscores.
export const markdown = new Marked(markedKatex({ nonStandard: true }));

// Only KaTeX creates markup; the rest of a doc comment remains escaped Svelte text.
export function math(node, token) {
  const render = (t) => katex.render(t.text, node, {
    displayMode: t.displayMode,
    throwOnError: false,
    trust: false,
  });
  render(token);
  return { update: render };
}
