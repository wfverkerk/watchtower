<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'danger'
}>(), {
  variant: 'secondary',
})
</script>

<template>
  <button
    type="button"
    class="min-h-[39px] rounded-[7px] border px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    :class="variant === 'primary'
      ? 'match-sync-primary border-orange bg-orange text-white'
      : variant === 'danger'
        ? 'app-button-danger border-[#c65a51] bg-[#c65a51] text-white'
        : 'match-sync-secondary border-line bg-page text-ink dark:bg-control'"
  >
    <slot />
  </button>
</template>
