<!-- The strip at a side pane's inner edge that the pane is dragged wider from. It is
     the pane's own colour, so the window reads as one surface with the drawing under
     it, and the only mark it makes is the grip in the middle of it. -->
<script>
  import { app, setPaneWidth } from "./lib/state.svelte.js";

  let { which } = $props();
  /* the index widens to the right of its grip, the detail to the left of its own */
  const side = which === "index" ? "left" : "right";
  const sign = which === "index" ? 1 : -1;

  let el, from = null;

  /* The pointer is captured on the strip, so a drag that runs out over the drawing keeps
     arriving here rather than becoming a pan of the canvas — which is also why the moves
     can be listened for on the strip itself rather than on the window. */
  function down(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    from = { x: e.clientX, w: app.pane[which] };
    app.sizing = true;
  }
  function move(e) {
    if (from) setPaneWidth(which, from.w + sign * (e.clientX - from.x));
  }
  function rest() {
    from = null;
    app.sizing = false;
  }
  /* the arrows widen and narrow, and always in the direction they point */
  function key(e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    app.sizing = true;
    const step = (e.shiftKey ? 32 : 8) * (e.key === "ArrowRight" ? 1 : -1);
    setPaneWidth(which, app.pane[which] + sign * step);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  class="ex-grip ex-grip-{side} ex-paper"
  role="separator"
  tabindex="0"
  aria-orientation="vertical"
  aria-label="How wide the {which} is"
  aria-valuenow={app.pane[which]}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={rest}
  onpointercancel={rest}
  onkeydown={key}
  onkeyup={rest}
  onblur={rest}
></div>
