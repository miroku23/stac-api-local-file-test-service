<template>
  <div class="grid h-full min-h-40 place-items-center px-4 py-10 text-center">
    <div class="max-w-md">
      <i v-if="icon" class="material-symbols-rounded icon mb-3 !text-5xl text-slate-300">{{ icon }}</i>
      <h3 class="text-base font-bold text-slate-700">{{ title }}</h3>
      <p v-if="description" class="mt-2 text-sm text-slate-500">{{ description }}</p>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  icon: { type: String, default: "draft" }
});
</script>
