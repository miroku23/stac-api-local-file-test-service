<template>
  <Menubar
    :model="[]"
    class="z-[4] min-w-0 items-center rounded-none border-x-0 border-t-0 border-white/20 bg-slate-950/70 px-3.5 py-0 text-white/95 backdrop-blur-xl"
  >
    <template #start>
      <div class="flex h-full min-w-0 flex-none items-center gap-2 text-[13px] font-semibold leading-none">
        <i class="material-symbols-rounded icon filled !text-[19px] !leading-none">deployed_code</i>
        <strong class="leading-none">{{ messages.common.appTitle }}</strong>
      </div>
    </template>
    <template #end>
      <div class="flex items-center gap-2">
        <Clock />
        <Button
          text
          class="!h-8 !w-8 !border-0 !bg-transparent !p-0 !text-white/85 hover:!bg-transparent hover:!text-white"
          :aria-label="messages.common.language"
          :title="currentLanguageLabel"
          @click="toggleLanguageMenu"
        >
          <template #icon>
            <i class="material-symbols-rounded icon !text-[20px]">language_korean_latin</i>
          </template>
        </Button>
        <Menu ref="languageMenuRef" :model="languageMenuItems" popup class="language-menu" />
      </div>
    </template>
  </Menubar>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { usePrimeVue } from "primevue/config";
import Button from "primevue/button";
import Menu from "primevue/menu";
import Menubar from "primevue/menubar";
import Clock from "../Clock.vue";

const store = useStore();
const primevue = usePrimeVue();
const languageMenuRef = ref(null);

const messages = computed(() => store.getters.messages);
const languageOptions = computed(() => store.getters.languageOptions);
const language = computed({
  get: () => store.getters.language,
  set: (value) => store.dispatch("setLanguage", value)
});
const currentLanguageLabel = computed(() => languageOptions.value.find((item) => item.value === language.value)?.label || messages.value.common.language);
const languageMenuItems = computed(() => languageOptions.value.map((item) => ({
  label: item.label,
  command: () => {
    language.value = item.value;
  }
})));

function toggleLanguageMenu(event) {
  languageMenuRef.value?.toggle(event);
}

watch(
  () => store.getters.primeVueLocale,
  (locale) => {
    primevue.config.locale = locale;
  },
  { immediate: true }
);
</script>
