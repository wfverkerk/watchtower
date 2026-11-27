<script setup lang="ts">
defineProps<{ title: string; eyebrow?: string; titleId?: string; closeLabel?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <header class="match-dialog-header flex items-start justify-between gap-4">
    <div>
      <p v-if="eyebrow" class="eyebrow mb-[5px]">{{ eyebrow }}</p>
      <h2 :id="titleId" class="m-0 text-[21px]">{{ title }}</h2>
    </div>
    <slot>
      <button v-if="closeLabel" class="match-dialog-close size-[30px] rounded-[7px] border border-line bg-panel text-xl leading-none text-muted" type="button" :aria-label="closeLabel" @click="emit('close')">×</button>
    </slot>
  </header>
</template>
