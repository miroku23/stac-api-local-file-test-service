<template>
  <div class="grid h-full place-items-center p-6 text-center">
    <div class="grid max-w-sm justify-items-center gap-3">
      <i class="material-symbols-rounded filled !text-[56px] text-slate-300">draft</i>
      <div class="grid gap-1">
        <strong class="text-base text-slate-700">{{ displayTitle }}</strong>
        <span class="text-sm text-[var(--zarr-muted)]">{{ displayDescription }}</span>
      </div>
      <div class="flex flex-wrap justify-center gap-2">
        <Button outlined size="small" :label="displayBrowseLabel" class="!min-h-9" @click="$emit('browse')">
          <template #icon>
            <i class="material-symbols-rounded icon">search</i>
          </template>
        </Button>
        <FileUpload
          mode="basic"
          :choose-label="displayLocalLabel"
          :accept="accept"
          :auto="false"
          :custom-upload="true"
          :pt="fileUploadPt"
          @select="$emit('select-local', $event)"
        >
          <template #chooseicon>
            <i class="material-symbols-rounded icon">folder_open</i>
          </template>
        </FileUpload>
      </div>
      <span v-if="message" class="text-xs leading-relaxed text-[var(--zarr-muted)]">{{ message }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import Button from "primevue/button";
import FileUpload from "primevue/fileupload";

const props = defineProps({
  title: { type: String, default: "" },
  description: { type: String, default: "" },
  browseLabel: { type: String, default: "" },
  localLabel: { type: String, default: "" },
  accept: { type: String, default: ".nc,.grib,.grib2,.grb2,.json,.geojson,.txt,.csv,.log,.xml,.yaml,.yml,.zip" },
  message: { type: String, default: "" }
});

defineEmits(["browse", "select-local"]);

const store = useStore();
const messages = computed(() => store.getters.messages);
const displayTitle = computed(() => props.title || messages.value.upload.emptyTitle);
const displayDescription = computed(() => props.description || messages.value.upload.emptyDescription);
const displayBrowseLabel = computed(() => props.browseLabel || messages.value.upload.browse);
const displayLocalLabel = computed(() => props.localLabel || messages.value.upload.localFile);

const fileUploadPt = {
  root: { class: "inline-flex" },
  basicContent: { class: "inline-flex items-center gap-2" },
  pcChooseButton: {
    root: { class: "!min-h-9 !px-3 !py-1.5" }
  }
};
</script>
