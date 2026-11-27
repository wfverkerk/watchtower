<script setup lang="ts">
import { computed, ref } from 'vue'
import { findOpponentTeam, suggestOpponentTeams, type OpponentTeam } from '../services/opponentTeams'
import TeamLogo from './TeamLogo.vue'

const props = defineProps<{ modelValue: string; teams: OpponentTeam[]; label: string; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [name: string]; pick: [team: OpponentTeam] }>()
const id = `opponent-${Math.random().toString(36).slice(2, 8)}`
const open = ref(false)
const active = ref(-1)

const suggestions = computed(() => open.value && !findOpponentTeam(props.teams, props.modelValue) ? suggestOpponentTeams(props.teams, props.modelValue) : [])

function update(value: string) {
  emit('update:modelValue', value)
  open.value = true
  active.value = -1
}

function choose(team: OpponentTeam) {
  emit('update:modelValue', team.name)
  emit('pick', team)
  open.value = false
  active.value = -1
}

function onKeydown(event: KeyboardEvent) {
  const count = suggestions.value.length
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!count) return
    event.preventDefault()
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
  } else if (event.key === 'Enter' && active.value >= 0 && suggestions.value[active.value]) {
    event.preventDefault()
    choose(suggestions.value[active.value])
  } else if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    open.value = false
  }
}
</script>

<template>
  <div class="opponent-input team-setup-field relative flex min-w-0 flex-1 flex-col gap-[5px] text-[10px] font-semibold text-[#77756e]">
    <label :for="id">{{ label }}</label>
    <div class="opponent-input-control flex items-center gap-2 [&_input]:min-h-[37px] [&_input]:min-w-0 [&_input]:flex-1 [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-white [&_input]:px-[9px] [&_input]:py-[7px] [&_input]:text-xs [&_input]:text-ink dark:[&_input]:bg-control">
      <TeamLogo :name="modelValue" :teams="teams" />
      <input
        :id="id" type="text" maxlength="60" role="combobox" autocomplete="off" aria-autocomplete="list"
        :aria-expanded="suggestions.length > 0" :aria-controls="`${id}-list`"
        :aria-activedescendant="active >= 0 ? `${id}-option-${active}` : undefined"
        :value="modelValue" :placeholder="placeholder"
        @input="update(($event.target as HTMLInputElement).value)" @focus="open = true" @blur="open = false" @keydown="onKeydown"
      >
    </div>
    <ul v-if="suggestions.length" :id="`${id}-list`" class="opponent-suggestions absolute inset-x-0 top-full z-5 m-0 mt-1 max-h-[260px] list-none overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-[0_8px_24px_rgb(0_0_0/14%)]" role="listbox">
      <li
        v-for="(team, index) in suggestions" :id="`${id}-option-${index}`" :key="team.id" role="option"
        class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-ink hover:bg-page"
        :aria-selected="index === active" :class="{ active: index === active, 'bg-page': index === active }"
        @mousedown.prevent @click="choose(team)"
      >
        <TeamLogo :name="team.name" :teams="teams" placeholder />
        <span>{{ team.name }}</span>
      </li>
    </ul>
  </div>
</template>
