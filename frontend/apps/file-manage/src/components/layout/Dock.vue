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
        v-tooltip.top="dockLabel(item, label)"
        class="!relative !h-[58px] !w-[58px] !rounded-[15px] !border-0 !bg-[linear-gradient(180deg,#18c3f5_0%,#0c9df0_52%,#0877ed_100%)] !p-0 !text-white !shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(0,118,255,0.3)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-white/80"
        :aria-label="dockLabel(item, label)"
        :title="dockLabel(item, label)"
        :pt="buttonPt"
        rounded
        @click.stop="openWindow(getDockItem(item).windowItem)"
      >
        <template #icon>
          <i class="material-symbols-rounded filled block text-4xl leading-none" aria-hidden="true">{{ getDockItem(item).materialIcon }}</i>
        </template>
      </Button>
    </template>
  </Dock>
</template>

<script setup>
import { computed, defineComponent, h, inject } from "vue";
import Button from "primevue/button";
import Dock from "primevue/dock";
import DownloadPanel from "../file/Download.vue";
import FileConvert from "../file/Convert.vue";
import FileDetail from "../file/Detail.vue";

const windowProvider = inject("windowProvider", null);
const StacPlaceholder = defineComponent({
  name: "StacPlaceholder",
  setup: () => () => h("section", { class: "grid h-full place-items-center text-sm text-slate-500" }, "STAC")
});

const dockComponents = {
  downloads: DownloadPanel,
  fileview: FileDetail,
  fileconvert: FileConvert,
  stac: StacPlaceholder
};

const dockWindows = computed(() => [
  {
    key: "downloads",
    label: "Downloads",
    icon: "cloud_download",
    description: "Run weather, ocean, and satellite data requests."
  },
  {
    key: "fileview",
    label: "FileView",
    icon: "quick_reference_all",
    description: "Inspect files and conversion details.",
    filePath: "",
    message: ""
  },
  {
    key: "fileconvert",
    label: "FileConvert",
    icon: "sync_alt",
    description: "Resample files and convert products to Zarr.",
    filePath: "",
    message: ""
  },
  {
    key: "stac",
    label: "STAC",
    icon: "desktop_cloud_stack",
    description: "STAC catalog and API workspace."
  }
]);

function getDockItem(item) {
  return item?.item || item || {};
}

function dockLabel(item, label) {
  return label || getDockItem(item).label || "";
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
  dockWindows.value.map((windowItem) => ({
    label: windowItem.label,
    materialIcon: windowItem.icon,
    windowItem
  }))
);

function openWindow(windowItem) {
  if (!windowItem) return;
  const component = dockComponents[windowItem.key];
  if (windowProvider?.open && component) {
    const { key, ...windowOptions } = windowItem;
    windowProvider.open({
      ...windowOptions,
      group: key
    }, {
      content: component,
      ...dockBindings(windowItem)
    });
  }
  writeViewToUrl(windowItem.key, true);
}

function dockBindings(windowItem) {
  if (windowItem.key === "fileview") {
    return {
      contentProps: (item) => ({
        filePath: item.filePath || "",
        fileRoot: item.fileRoot,
        message: item.message || ""
      }),
      contentEvents: (item) => ({
        loading: (loading) => windowProvider.patch(item.key, { loading })
      })
    };
  }
  if (windowItem.key === "fileconvert") {
    return {
      contentProps: (item) => ({
        filePath: item.filePath || "",
        fileRoot: item.fileRoot,
        message: item.message || ""
      }),
      contentEvents: (item) => ({
        loading: (loading) => windowProvider.patch(item.key, { loading })
      })
    };
  }
  return {};
}

function writeViewToUrl(nextView, replace = false) {
  const url = new URL(window.location.href);
  if (nextView === "fileview") url.searchParams.delete("view");
  else url.searchParams.set("view", nextView);
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ fileManageView: nextView }, "", url);
}
</script>
