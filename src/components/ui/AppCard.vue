<script setup lang="ts">
withDefaults(defineProps<{
  tag?: string
  title?: string
}>(), {
  tag: 'section',
})
</script>

<template>
  <component :is="tag" class="rounded-[11px] border border-line bg-panel p-5 max-sm:p-4">
    <h2 v-if="title" class="text-xl">{{ title }}</h2>
    <slot />
  </component>
</template>
