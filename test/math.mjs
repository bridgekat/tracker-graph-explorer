import assert from "node:assert/strict";
import { markdown } from "../src/lib/math.js";

const tokens = (text) => {
  const found = [];
  markdown.walkTokens(markdown.lexer(text), (t) => found.push(t));
  return found;
};
const formulas = (text) => tokens(text).filter((t) => /^(inline|block)Katex$/.test(t.type));

assert.equal(formulas("A norm $\\|x_i\\|$ and ($a_b$).")[0].text, "\\|x_i\\|");
assert.equal(formulas("A norm $\\|x_i\\|$ and ($a_b$).").length, 2);
assert.equal(formulas("**$x_1$** and *$x_2$*").length, 2);
assert.equal(formulas("- $x_1$\n\n> $x_2$").length, 2);
assert.equal(formulas("| value |\n| --- |\n| $x_1$ |").length, 1);
const [display] = formulas("$$\n\\begin{aligned}a_b &= c_d \\\\\n e &= f\\end{aligned}\n$$");
assert.equal(display.type, "blockKatex");
assert.equal(display.displayMode, true);
assert.match(display.text, /a_b &= c_d/);
assert.equal(formulas("$$x^2$$")[0].displayMode, true);
assert.equal(formulas("\x60$x$\x60\n\n\x60\x60\x60lean\n$x$\n\x60\x60\x60").length, 0);
assert.equal(formulas("\\$5 and an unmatched $x").length, 0);
console.log("Math token regression checks passed.");
