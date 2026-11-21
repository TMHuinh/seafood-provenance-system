<script setup lang="ts">
defineProps<{
  label: string
  modelValue: string | number
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="decimal-field">
    <span>{{ label }}</span>
    <input
      type="number"
      inputmode="decimal"
      step="any"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </label>
</template>

<style scoped>
.decimal-field { display: grid; align-content: start; gap: var(--app-space-1); min-width: 0; }
.decimal-field span { color: var(--app-primary-dark); font-size: 12px; font-weight: 650; }
.decimal-field input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--app-line);
  border-radius: var(--app-control-radius);
  background: var(--app-surface);
  color: var(--app-ink);
}
.decimal-field input:disabled { opacity: .6; cursor: not-allowed; }
.decimal-field input:read-only { background: var(--app-canvas); }
</style>
