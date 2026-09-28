<template>
  <div v-if="visible" class="tool-panel"><strong>工具调用状态</strong><pre>{{ status }}</pre></div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  status: string
}>()
</script>

<style scoped>
.tool-panel { margin:0 0 12px 34px; padding:10px 12px; border-left:3px solid #c8e86b; background:#f4f7ed; color:#4b594e; font:11px Arial,sans-serif; }.tool-panel strong { color:#174d3b; }.tool-panel pre { margin:7px 0 0; white-space:pre-wrap; font:10px/1.55 Consolas,monospace; }
</style>