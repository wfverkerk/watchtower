<script setup lang="ts">
defineProps<{ title: string; eyebrow?: string; titleId?: string; closeLabel?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <header class="match-dialog-header">
    <div>
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h2 :id="titleId">{{ title }}</h2>
    </div>
    <button v-if="closeLabel" class="match-dialog-close" type="button" :aria-label="closeLabel" @click="emit('close')">×</button>
  </header>
</template>
