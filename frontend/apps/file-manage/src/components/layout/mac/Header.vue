<template>
  <Menubar
    :model="[]"
    class="z-[4] min-w-0 items-center rounded-none border-x-0 border-t-0 border-white/20 bg-slate-950/70 px-3.5 py-0 text-white/95 backdrop-blur-xl"
  >
    <template #start>
      <div class="flex h-full min-w-0 flex-none items-center gap-2 text-sm font-semibold leading-none">
        <i class="material-symbols-rounded icon filled !text-xl !leading-none">deployed_code</i>
        <strong class="leading-none">{{ messages.common.appTitle }}</strong>
      </div>
    </template>
    <template #end>
      <div class="flex items-center gap-2">
        <Clock />
        <Lang />
      </div>
    </template>
  </Menubar>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import Menubar from "primevue/menubar";
import Clock from "../Clock.vue";
import Lang from "../Lang.vue";

const store = useStore();

const messages = computed(() => store.getters.messages);
</script>
