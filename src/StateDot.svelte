<!-- The dot that says what state a group or a declaration is in, by colour. -->
<script>
  import { STATE_LABEL } from "./lib/util.js";
  let { state } = $props();
</script>

<i
  class="inline-block h-2 w-2 shrink-0 rounded-full"
  style="background: var(--st-{state})"
  title={STATE_LABEL[state]}
></i>
