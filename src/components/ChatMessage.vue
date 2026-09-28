<template>
  <div class="chat-message" :class="role === 'user' ? 'is-user' : 'is-agent'"><span class="message-role">{{ role === 'user' ? '您' : '顾问' }}</span><p>{{ content }}</p></div>
</template>

<script setup lang="ts">
defineProps<{
  role: string
  content: string | null
}>()
</script>

<style scoped>
.chat-message { display:flex; gap:9px; align-items:flex-start; margin:0 0 12px; font:12px/1.65 Arial,sans-serif; }.message-role { display:grid; flex:none; place-items:center; width:25px; height:25px; color:#fff; background:#174d3b; font:700 10px Arial,sans-serif; }.chat-message p { max-width:78%; margin:0; padding:9px 11px; white-space:pre-wrap; background:#f0f4ec; color:#26312a; }.is-user { flex-direction:row-reverse; }.is-user .message-role { background:#f36b3f; }.is-user p { background:#fff2ec; }
</style>