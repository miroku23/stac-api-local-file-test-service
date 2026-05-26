<template>
  <div class="ml-auto flex h-full min-w-48 flex-none items-center justify-end gap-2 text-xs font-semibold leading-none">
    <i class="material-symbols-rounded icon !text-[18px] !leading-none">cloud_done</i>
    <span class="flex h-full items-center px-2 leading-none">{{ clockText }}</span>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";

const store = useStore();
const clockText = ref("");
const dateLocale = computed(() => store.getters.dateLocale);
let clockTimer;

function updateClock() {
  clockText.value = new Intl.DateTimeFormat(dateLocale.value, {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

onMounted(() => {
  updateClock();
  clockTimer = window.setInterval(updateClock, 30000);
});

onBeforeUnmount(() => {
  window.clearInterval(clockTimer);
});

watch(dateLocale, updateClock);
</script>
