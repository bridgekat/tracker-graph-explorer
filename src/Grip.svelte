<!-- The line between two panes. Dragging it resizes the pane beside it; the canvas
     needs no telling, since it watches its own element. -->
<script>
  let { id, label, width, dir = 1, hidden = false, onresize } = $props();

  const MIN = 190;
  let drag = $state(null);
  let vw = $state(innerWidth);
  let el;

  const max = $derived(Math.round(vw * 0.45));
  const clamp = (w) => Math.round(Math.max(MIN, Math.min(max, w)));

  function down(e) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, w: width, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
  }
  function move(e) {
    if (drag) onresize(clamp(drag.w + dir * (e.clientX - drag.x)));
  }
  function up() {
    if (!drag) return;
    try { el.releasePointerCapture(drag.id); } catch { /* already gone */ }
    drag = null;
    document.body.classList.remove("resizing");
  }
  function key(e) {
    const step = e.key === "ArrowLeft" ? -20 : e.key === "ArrowRight" ? 20 : 0;
    if (!step) return;
    e.preventDefault();
    onresize(clamp(width + dir * step));
  }
</script>

<svelte:window bind:innerWidth={vw} />

<!-- A separator that takes focus and answers the arrow keys is a window splitter, which is
     what the value attributes below say. Svelte reads the role alone and calls it inert. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="ex-grip" class:dragging={!!drag} {id} {hidden} bind:this={el}
  role="separator" aria-orientation="vertical" aria-label={label} tabindex="0"
  aria-valuenow={width} aria-valuemin={MIN} aria-valuemax={max}
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}
  ondblclick={() => onresize(dir === 1 ? 272 : 352)} onkeydown={key}>
</div>
