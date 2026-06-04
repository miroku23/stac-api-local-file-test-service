<template>
  <div class="mac-desktop relative grid min-h-screen min-w-80 grid-rows-[34px_minmax(0,1fr)_86px] overflow-hidden text-slate-900" :class="fontClass" :lang="language">
    <Modal>
		<MacHeader />
    	<MacContents />
    	<MacFooter />
    </Modal>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import MacContents from "../components/layout/mac/Contents.vue";
import MacFooter from "../components/layout/mac/Footer.vue";
import MacHeader from "../components/layout/mac/Header.vue";
import Modal from "../provide/Modal.vue";

const store = useStore();
const language = computed(() => store.getters.language);
const fontClass = computed(() => `ui-font-${language.value}`);
</script>
