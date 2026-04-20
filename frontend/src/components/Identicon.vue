<template>
  <div
    :class="['avatar', className]"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <div v-html="svg" v-if="svg" aria-hidden="true"></div>
    <div v-else class="bg-base-300" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import * as jdenticon from "jdenticon";

const props = defineProps({
  seed: { type: String, default: "" },
  size: { type: Number, default: 40 },
  className: { type: String, default: "" },
});

const svg = computed(() => {
  try {
    const s = props.seed || "unknown";
    return jdenticon.toSvg(s, props.size);
  } catch (e) {
    console.warn("Failed to create identicon", e);
    return "";
  }
});
</script>

<style scoped>
.avatar > div > svg {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
