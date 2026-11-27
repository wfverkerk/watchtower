<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'info' | 'error'
}>(), {
  tone: 'info',
})
</script>

<template>
  <p
    :class="tone === 'error'
      ? 'mt-3 rounded-md border border-[#f0c5ad] bg-[#fff8f4] px-3 py-[9px] text-[11px] text-[#a34320] dark:border-[#684536] dark:bg-[#33251f] dark:text-[#ffb18d]'
      : 'text-xs leading-[1.5] text-muted'"
  >
    <slot />
  </p>
</template>
