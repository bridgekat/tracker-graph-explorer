import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import katex from "katex";

// Lean doc comments may wrap either kind of math across source lines.
// Delimiter placement does not change display mode; Markdown still owns code.
const display = /^\$\$((?:\\[\s\S]|[^\\])+?)\$\$/;
const inline = /^\$(?!\$)((?:\\[\s\S]|[^\\$])+?)\$(?!\$)/;
const extension = markedKatex({ nonStandard: true });
for (const rule of extension.extensions) {
  const block = rule.level === "block";
  if (!block) rule.start = (src) => src.indexOf("$");
  rule.tokenizer = (src) => {
    const shown = display.exec(src);
    const match = shown || (!block && inline.exec(src));
    if (match) return {
      type: rule.name, raw: match[0], text: match[1].trim(), displayMode: !!shown,
    };
  };
}
export const markdown = new Marked(extension);

export function lexDocComment(text, citationLinks) {
  if (!citationLinks.size) return markdown.lexer(text);
  // Seed reference definitions without appending anything to the doc comment.
  const lexer = new markdown.Lexer(markdown.defaults);
  for (const [, key] of text.matchAll(/\[([a-z0-9:_-]+)\]/gi)) {
    const href = citationLinks.get(key);
    if (href) lexer.tokens.links[key.toLowerCase()] = { href };
  }
  return lexer.lex(text);
}

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
