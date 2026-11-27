<script setup lang="ts">
withDefaults(defineProps<{
  status?: string
}>(), {
  status: 'neutral',
})
</script>

<template>
  <span
    :data-status="status"
    class="justify-self-start rounded-full bg-line px-2.5 py-0.5 text-xs font-bold data-[status=closed]:bg-[#fff2cc] data-[status=closed]:text-[#6b4e00] data-[status=final]:bg-[#dae8fc] data-[status=final]:text-[#1d3d7a] data-[status=in_review]:bg-[#fff2cc] data-[status=in_review]:text-[#6b4e00] data-[status=live]:animate-[live-pulse_1.6s_ease-in-out_infinite] data-[status=live]:bg-[#e5484d] data-[status=live]:tracking-[0.04em] data-[status=live]:text-white data-[status=live]:uppercase data-[status=open]:bg-[#d5e8d4] data-[status=open]:text-[#1f5a1a] motion-reduce:data-[status=live]:animate-none"
  >
    <slot />
  </span>
</template>
