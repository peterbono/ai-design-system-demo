<script lang="ts">
  import { Button } from '@bridge-ds/react';
  import { Dialog } from '@mui/material';
  let open = false;
  let name = '';
</script>

<svelte:head><title>Settings</title></svelte:head>

<Button on:click={() => (open = true)}>Open</Button>
<Dialog {open} />
<button on:click={() => (open = false)}>Close</button>
<input bind:value={name} type="checkbox" />
<a href="/x" style:color="#15202b">Link</a>
<noscript><input type="text" /></noscript>
{#if open}
  <textarea style="font-size: 13px"></textarea>
{/if}

<style>
  button {
    padding: 13px;
  }
</style>
