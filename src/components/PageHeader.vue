<script setup lang="ts">
defineProps<{ eyebrow: string; title: string }>()
</script>

<template>
  <header class="page-header">
    <div><p class="eyebrow">{{ eyebrow }}</p><h1>{{ title }}</h1></div>
    <slot />
  </header>
</template>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.page-header h1 { margin: 0; font-size: 26px; }
@media (max-width: 600px) { .page-header h1 { font-size: 22px; } }
</style>
