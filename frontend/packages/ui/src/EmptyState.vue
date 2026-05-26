<template>
  <div class="empty-state">
    <strong>{{ title }}</strong>
    <span v-if="description">{{ description }}</span>
  </div>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    default: "No data"
  },
  description: {
    type: String,
    default: ""
  }
});
</script>
