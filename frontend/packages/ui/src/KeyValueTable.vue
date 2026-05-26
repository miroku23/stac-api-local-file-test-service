<template>
  <table class="kv-table">
    <tbody>
      <tr v-for="row in rows" :key="row.key">
        <th>{{ row.key }}</th>
        <td>{{ row.value }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup>
import { computed } from "vue";
import lodash from "lodash";

const { toPairs } = lodash;

const props = defineProps({
  value: {
    type: Object,
    default: () => ({})
  }
});

const rows = computed(() =>
  toPairs(props.value).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.join(", ") : String(value ?? "")
  }))
);
</script>
