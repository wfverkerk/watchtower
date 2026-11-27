<script lang="ts">
const dialogStack: { id: symbol; modal: boolean }[] = []
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  backdropClass?: string
  dialogClass?: string
  variant?: 'standard' | 'player' | 'wizard' | 'page'
  size?: 'sm' | 'md' | 'lg' | 'wide'
  align?: 'center' | 'bottom'
  label?: string
  labelledby?: string
  modal?: boolean
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}>(), {
  backdropClass: '',
  dialogClass: '',
  variant: 'standard',
  size: 'md',
  align: 'center',
  modal: true,
  closeOnBackdrop: false,
  closeOnEscape: true,
})

const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement | null>(null)
const id = Symbol('dialog')
let previousFocus: HTMLElement | null = null

const backdropClasses = computed(() => [
  props.backdropClass,
  props.variant === 'page'
    ? 'min-h-[calc(100dvh-74px)] grid place-items-start justify-items-center py-7 max-sm:min-h-[calc(100dvh-62px)] max-sm:py-3'
    : 'fixed inset-0 z-25 grid justify-items-center bg-[#24232366] p-[calc(18px+env(safe-area-inset-top))_calc(18px+env(safe-area-inset-right))_calc(18px+env(safe-area-inset-bottom))_calc(18px+env(safe-area-inset-left))]',
  props.variant === 'page' ? '' : props.align === 'bottom' ? 'items-end max-sm:items-end' : 'items-center',
  props.variant === 'player' ? 'player-picker-backdrop dark:bg-[#08090dcc]' : '',
  props.variant === 'wizard' ? 'team-setup-backdrop max-sm:items-end max-sm:p-[calc(10px+env(safe-area-inset-top))_calc(10px+env(safe-area-inset-right))_calc(10px+env(safe-area-inset-bottom))_calc(10px+env(safe-area-inset-left))]' : '',
  props.variant === 'standard' ? 'match-dialog-backdrop z-20 bg-black/48' : '',
])

const dialogClasses = computed(() => [
  props.dialogClass,
  'panel outline-none',
  props.variant === 'player'
    ? 'player-picker w-[min(100%,430px)] overflow-x-hidden overflow-y-auto rounded-[14px] p-[22px] shadow-[0_14px_50px_#24232330] max-sm:p-[18px_15px_14px]'
    : props.variant === 'wizard'
      ? 'team-setup-dialog flex w-[min(100%,560px)] flex-col overflow-hidden rounded-[14px] p-[22px] shadow-[0_14px_50px_#24232330] max-sm:rounded-t-[14px] max-sm:rounded-b-[10px] max-sm:px-[15px] max-sm:pt-[18px] max-sm:pb-[14px]'
      : 'overflow-y-auto shadow-[0_18px_60px_rgb(0_0_0/20%)]',
  props.variant === 'standard' || props.variant === 'player'
    ? 'max-h-[calc(100dvh-36px-env(safe-area-inset-top)-env(safe-area-inset-bottom))]'
    : 'max-h-[calc(100dvh-36px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-sm:max-h-[calc(100dvh-20px-env(safe-area-inset-top)-env(safe-area-inset-bottom))]',
  props.variant === 'standard' ? (props.size === 'lg' ? 'p-[22px]' : 'p-5') : '',
  props.variant === 'page' ? 'p-[30px] max-sm:px-[15px] max-sm:pt-[18px] max-sm:pb-[14px]' : '',
  {
    sm: 'w-[min(100%,360px)]',
    md: 'w-[min(100%,410px)]',
    lg: 'w-[min(100%,520px)]',
    wide: 'w-[min(100%,760px)]',
  }[props.size],
])

function isTopDialog() {
  const top = [...dialogStack].reverse().find((item) => item.modal) ?? dialogStack[dialogStack.length - 1]
  return top?.id === id
}

function focusableElements() {
  if (!dialog.value) return []
  return Array.from(dialog.value.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex]',
  )).filter((element) =>
    element.tabIndex >= 0
    && !element.matches(':disabled')
    && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden',
  )
}

function handleKeydown(event: KeyboardEvent) {
  if (!isTopDialog()) return
  if (event.key === 'Escape' && props.closeOnEscape) {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (!props.modal || event.key !== 'Tab' || !dialog.value) return
  const elements = focusableElements()
  const first = elements[0]
  const last = elements[elements.length - 1]
  const active = document.activeElement
  if (!first || !last) {
    event.preventDefault()
    dialog.value.focus({ preventScroll: true })
  } else if (event.shiftKey && (active === first || !dialog.value.contains(active) || active === dialog.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !dialog.value.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

function handleFocus(event: FocusEvent) {
  if (props.modal && isTopDialog() && dialog.value && !dialog.value.contains(event.target as Node)) {
    dialog.value.focus({ preventScroll: true })
  }
}

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialogStack.push({ id, modal: props.modal })
  window.addEventListener('keydown', handleKeydown, true)
  document.addEventListener('focusin', handleFocus, true)
  if (props.modal) {
    void nextTick(() => {
      if (isTopDialog()) dialog.value?.focus({ preventScroll: true })
    })
  }
})

onBeforeUnmount(() => {
  const wasTop = isTopDialog()
  const index = dialogStack.findIndex((item) => item.id === id)
  if (index !== -1) dialogStack.splice(index, 1)
  window.removeEventListener('keydown', handleKeydown, true)
  document.removeEventListener('focusin', handleFocus, true)
  if (props.modal && wasTop && previousFocus?.isConnected && !previousFocus.matches(':disabled')) {
    previousFocus.focus({ preventScroll: true })
  }
})
</script>

<template>
  <div :class="backdropClasses" @click.self="closeOnBackdrop && emit('close')">
    <section
      ref="dialog"
      :class="dialogClasses"
      :role="modal ? 'dialog' : 'region'"
      :aria-modal="modal ? true : undefined"
      :aria-label="label"
      :aria-labelledby="labelledby"
      :tabindex="modal ? -1 : undefined"
    >
      <slot />
    </section>
  </div>
</template>
