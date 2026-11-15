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
  <div class="opponent-input team-setup-field">
    <label :for="id">{{ label }}</label>
    <div class="opponent-input-control">
      <TeamLogo :name="modelValue" :teams="teams" />
      <input
        :id="id" type="text" maxlength="60" role="combobox" autocomplete="off" aria-autocomplete="list"
        :aria-expanded="suggestions.length > 0" :aria-controls="`${id}-list`"
        :aria-activedescendant="active >= 0 ? `${id}-option-${active}` : undefined"
        :value="modelValue" :placeholder="placeholder"
        @input="update(($event.target as HTMLInputElement).value)" @focus="open = true" @blur="open = false" @keydown="onKeydown"
      >
    </div>
    <ul v-if="suggestions.length" :id="`${id}-list`" class="opponent-suggestions" role="listbox">
      <li
        v-for="(team, index) in suggestions" :id="`${id}-option-${index}`" :key="team.id" role="option"
        :aria-selected="index === active" :class="{ active: index === active }"
        @mousedown.prevent @click="choose(team)"
      >
        <TeamLogo :name="team.name" :teams="teams" placeholder />
        <span>{{ team.name }}</span>
      </li>
    </ul>
  </div>
</template>
