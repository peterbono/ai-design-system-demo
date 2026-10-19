<script setup lang="ts">
import { Button, Button as DsButton } from '@bridge-ds/react';
import { ref } from 'vue';
const q = ref('');
const url = '/docs';
const go = () => {};
</script>

<template>
  <main class="page p-[13px]">
    <Button>Save</Button>
    <ds-button>Kebab case</ds-button>
    <button @click="go">Go</button>
    <input v-model="q" type="text" />
    <input type="hidden" name="t" />
    <a :href="url">Docs</a>
    <div :style="{ color: '#15202b', padding: 'var(--space-4)' }"></div>
    <my-widget></my-widget>
    <!-- bridge-audit-ignore-next-line: third-party embed reads this native select -->
    <select><option>A</option></select>
  </main>
</template>

<style scoped lang="scss">
.page {
  margin: 13px;
  color: var(--color-text-default);
}
</style>
