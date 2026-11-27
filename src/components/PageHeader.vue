<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string }>()
</script>

<template>
  <header class="page-header flex items-center justify-between gap-3">
    <div><p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p><h1 class="m-0 text-[26px] max-sm:text-[22px]">{{ title }}</h1></div>
    <slot />
  </header>
</template>
