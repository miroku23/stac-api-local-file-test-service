<template>
  <div class="mac-desktop relative grid min-h-screen min-w-80 grid-rows-[34px_minmax(0,1fr)_86px] overflow-hidden text-slate-900">
    <MacHeader />
    <MacContents />
    <MacFooter />
  </div>
</template>

<script setup>
import MacContents from "../components/layout/mac/Contents.vue";
import MacFooter from "../components/layout/mac/Footer.vue";
import MacHeader from "../components/layout/mac/Header.vue";
</script>
