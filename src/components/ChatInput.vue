<template>
  <form class="chat-input" @submit.prevent="handleSend">
    <input
      v-model="text"
      placeholder="输入机械零件需求，例如：轴承座怎么报价？"
      @keyup.enter="handleSend"
    />
    <button type="submit" :disabled="loading">发送 <span>→</span></button>
    <button class="stop-button" type="button" :disabled="!loading" aria-label="停止生成" title="停止生成" @click="$emit('stop')">停止</button>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ loading: boolean }>()
const text = ref('')
const emit = defineEmits<{
  (e: 'send', value: string): void
  (e: 'stop'): void
}>()

function handleSend() {
  if (props.loading || !text.value.trim()) return
  emit('send', text.value.trim())
  text.value = ''
}
</script>

<style scoped>
.chat-input { display:flex; gap:8px; padding:12px 18px 18px; border-top:1px solid #dfe5df; }
.chat-input input { min-width:0; flex:1; padding:11px 12px; border:1px solid #dfe5df; border-radius:0; color:#17211b; background:#f8faf6; font:12px Arial,sans-serif; outline:none; }.chat-input input:focus { border-color:#174d3b; }
.chat-input button { padding:0 14px; border:0; background:#174d3b; color:#fff; cursor:pointer; font:700 11px Arial,sans-serif; }.chat-input button span { margin-left:8px; font-size:15px; }.chat-input button:disabled { opacity:.45; cursor:not-allowed; }.chat-input .stop-button { width:auto; min-width:42px; height:36px; padding:0 8px; background:transparent; color:#174d3b; font-size:11px; }.chat-input .stop-button:hover:not(:disabled) { background:#e7eee3; }
</style>