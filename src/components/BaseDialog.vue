<script lang="ts">
const dialogStack: { id: symbol; modal: boolean }[] = []
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  backdropClass: string
  dialogClass: string
  label?: string
  labelledby?: string
  modal?: boolean
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}>(), {
  modal: true,
  closeOnBackdrop: false,
  closeOnEscape: true,
})

const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement | null>(null)
const id = Symbol('dialog')
let previousFocus: HTMLElement | null = null

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
  <div :class="backdropClass" @click.self="closeOnBackdrop && emit('close')">
    <section
      ref="dialog"
      :class="dialogClass"
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
