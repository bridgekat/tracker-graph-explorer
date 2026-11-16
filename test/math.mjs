import assert from "node:assert/strict";
import katex from "katex";
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
assert.equal(formulas("$$x^2$$")[0].type, "blockKatex");
assert.equal(formulas("before $$x^2$$ after")[0].displayMode, true);
const [wrappedInline] = formulas("A $x_1 +\n x_2$ value.");
assert.equal(wrappedInline.text, "x_1 +\n x_2");
assert.equal(wrappedInline.displayMode, false);
assert.equal(formulas("$\nx_1\n$")[0].displayMode, false);
assert.equal(formulas("\x60$$x$$\x60 and \x60$x\n+y$\x60").length, 0);
assert.equal(formulas("\\$\\$x\\$\\$").length, 0);
assert.equal(formulas("\x60$x$\x60\n\n\x60\x60\x60lean\n$x$\n\x60\x60\x60").length, 0);
assert.equal(formulas("\\$5 and an unmatched $x").length, 0);

// The recurrence in Numlib/Krylov/CG.lean: wrapped lines, attached delimiters.
const cg = "$$\\alpha_k = \\frac{\\langle r_k, r_k \\rangle}{\\langle A p_k, p_k \\rangle}, \\quad x_{k+1} = x_k +\n  \\alpha_k p_k, \\quad r_{k+1} = r_k - \\alpha_k A p_k, \\quad \\beta_k = \\frac{\\langle r_{k+1}, r_{k+1}\n  \\rangle}{\\langle r_k, r_k \\rangle}, \\quad p_{k+1} = r_{k+1} + \\beta_k p_k.$$";
const [cgMath] = formulas("The recurrence is\n" + cg + "\nThis is Algorithm 6.18.");
assert.equal(formulas(cg).length, 1);
assert.equal(cgMath.text, cg.slice(2, -2));
assert.equal(cgMath.displayMode, true);
assert.doesNotThrow(() => katex.renderToString(cgMath.text, { displayMode: true }));
assert.equal(formulas("\x60" + cg + "\x60").length, 0);
assert.equal(formulas("\x60\x60\x60latex\n" + cg + "\n\x60\x60\x60").length, 0);
assert.equal(formulas("$$a\\\\\n b$$ and $$c\\$d\n e$$").length, 2);

console.log("Math token regression checks passed.");
