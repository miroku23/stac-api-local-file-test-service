<template>
  <Dock
    class="bottom-3"
    :model="dockItems"
    position="bottom"
    :pt="dockPt"
    :tooltip-options="{ position: 'top' }"
  >
    <template #item="{ item, label }">
      <Button
        class="!relative !h-[58px] !w-[58px] !rounded-[15px] !border-0 !bg-[linear-gradient(180deg,#18c3f5_0%,#0c9df0_52%,#0877ed_100%)] !p-0 !text-white !shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(0,118,255,0.3)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-white/80"
        :aria-label="label || getDockItem(item).label"
        :pt="buttonPt"
        rounded
        @click.stop="emit('open', getDockItem(item).windowItem)"
      >
        <template #icon>
          <i class="material-symbols-rounded filled block text-[34px] leading-none" aria-hidden="true">{{ getDockItem(item).materialIcon }}</i>
        </template>
      </Button>
    </template>
  </Dock>
</template>

<script setup>
import { computed } from "vue";
import Button from "primevue/button";
import Dock from "primevue/dock";

const props = defineProps({
  windows: {
    type: Array,
    required: true
  }
});

const emit = defineEmits(["open"]);

function getDockItem(item) {
  return item?.item || item || {};
}

const dockPt = {
  listContainer: {
    class:
      "rounded-2xl border border-white/20 bg-slate-950/35 p-2 shadow-[0_18px_50px_rgba(6,22,32,0.28)] backdrop-blur-xl"
  },
  list: {
    class: "items-center justify-center gap-3 p-0"
  },
  item: {
    class: "flex h-[58px] w-[58px] items-center justify-center"
  },
  itemContent: {
    class: "flex h-[58px] w-[58px] items-center justify-center"
  },
  itemLink: {
    class: "flex h-[58px] w-[58px] items-center justify-center rounded-[15px] p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
  }
};
const buttonPt = {
  icon: {
    class: "!absolute !left-1/2 !top-1/2 !m-0 !block !-translate-x-1/2 !-translate-y-1/2 !leading-none"
  },
  label: {
    class: "hidden"
  }
};

const dockItems = computed(() =>
  props.windows.map((windowItem) => ({
    label: windowItem.label,
    materialIcon: windowItem.icon,
    windowItem
  }))
);
</script>
