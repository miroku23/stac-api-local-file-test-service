<template>
  <Button
    v-if="interactive"
    text
    :class="buttonClass"
    :aria-label="label"
    :draggable="draggable"
    @click="$emit('click', $event)"
    @dblclick="$emit('dblclick', $event)"
    @contextmenu="$emit('contextmenu', $event)"
    @dragstart="$emit('dragstart', $event)"
  >
    <i
      class="material-symbols-rounded filled leading-none"
      :class="[sizeClass, toneClass, shadowClass]"
      aria-hidden="true"
    >
      {{ iconName }}
    </i>
    <span v-if="label" :class="labelClass">{{ label }}</span>
  </Button>
  <i
    v-else
    class="material-symbols-rounded filled leading-none"
    :class="[sizeClass, toneClass, shadowClass]"
    aria-hidden="true"
  >
    {{ iconName }}
  </i>
</template>

<script setup>
import { computed } from "vue";
import Button from "primevue/button";

const props = defineProps({
  type: {
    type: String,
    default: "file"
  },
  size: {
    type: String,
    default: "grid"
  },
  label: {
    type: String,
    default: ""
  },
  selected: {
    type: Boolean,
    default: false
  },
  interactive: {
    type: Boolean,
    default: false
  },
  draggable: {
    type: Boolean,
    default: false
  }
});

defineEmits(["click", "dblclick", "contextmenu", "dragstart"]);

const iconName = computed(() => {
  if (props.type === "database") return "database";
  if (props.type === "tasks") return "pending_actions";
  if (props.type === "folder") return "folder";
  return "draft";
});

const toneClass = computed(() => {
  if (props.type === "database") return "text-cyan-400";
  if (props.type === "tasks") return "text-emerald-400";
  if (props.type === "folder") return "text-sky-400";
  return "text-slate-300";
});

const shadowClass = computed(() =>
  props.type === "file" ? "drop-shadow-[0_1px_0_rgba(15,23,42,0.16)]" : "drop-shadow-[0_3px_0_rgba(2,132,199,0.42)]"
);

const sizeClass = computed(() => {
  if (props.size === "desktop") return "!text-[72px]";
  if (props.size === "list") return "!text-[24px]";
  if (props.size === "small") return "!text-[22px]";
  return props.type === "folder" ? "!text-[82px]" : "!text-[76px]";
});

const buttonClass = computed(() => {
  if (props.size === "desktop") {
    return "!grid !h-[108px] !w-[104px] !content-start !justify-items-center !gap-2 !rounded-xl !border-0 !bg-transparent !p-2 !text-white hover:!bg-white/15 focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-white/80";
  }
  if (props.size === "list") {
    return props.selected ? "!bg-sky-100" : "!bg-white";
  }
  return [
    "!grid !h-[132px] !w-[124px] !content-start !justify-items-center !gap-2.5 !rounded-xl !border-0 !bg-transparent !p-2 !text-slate-700 hover:!bg-sky-50",
    props.selected ? "!bg-sky-100 ring-2 ring-sky-400" : ""
  ];
});

const labelClass = computed(() => {
  if (props.size === "desktop") {
    return "line-clamp-2 max-w-full break-all rounded bg-slate-950/25 px-1.5 py-0.5 text-center text-[13px] font-semibold leading-tight shadow-sm";
  }
  return "line-clamp-2 max-w-full break-all text-center text-[13px] font-semibold leading-tight";
});
</script>
