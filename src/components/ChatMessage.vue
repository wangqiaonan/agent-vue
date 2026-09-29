<template>
  <div class="message" :class="role">
    <div class="bubble" v-html="renderedContent"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{
  role: string
  content: string | null
}>()

const renderedContent = computed(() => {
  if (!props.content) return ''
  const rawHtml = marked.parse(props.content) as string
  return DOMPurify.sanitize(rawHtml)
})
</script>

<style scoped>
.message {
  display: flex;
  margin-bottom: 8px;
}
.message.user {
  justify-content: flex-end;
}
.message.assistant {
  justify-content: flex-start;
}
.bubble {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 12px;
  white-space: pre-wrap;
  line-height: 1.5;
  word-break: break-word;
}
.user .bubble {
  background: #007aff;
  color: white;
}
.assistant .bubble {
  background: white;
  color: #333;
  border: 1px solid #e5e5e5;
}
</style>