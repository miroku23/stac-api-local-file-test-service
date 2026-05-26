<template>
  <div class="h-full min-h-0 overflow-hidden">
    <TreeTable
      :value="nodes"
      size="small"
      scrollable
      showGridlines
      resizableColumns
      columnResizeMode="expand"
      scroll-height="flex"
      class="metadata-tree-table h-full min-h-0 text-sm"
    >
      <Column field="name" header="Name" expander style="width: 30%; min-width: 220px" />
      <Column field="dtype" header="Type" style="width: 12%; min-width: 90px" />
      <Column field="dimensions" header="Dimensions" style="width: 14%; min-width: 110px" />
      <Column field="shape" header="Shape" style="width: 12%; min-width: 90px" />
      <Column field="value" header="Value" style="width: 32%; min-width: 260px" />
    </TreeTable>
  </div>
</template>

<script setup>
import { computed } from "vue";
import TreeTable from "primevue/treetable";
import Column from "primevue/column";

const props = defineProps({
  detail: {
    type: Object,
    default: () => ({})
  }
});

const nodes = computed(() => (props.detail.sections || []).map((section, index) => sectionToNode(section, `section:${index}`)));

function sectionToNode(section, key) {
  return {
    key,
    data: {
      name: section.name,
      kind: "section",
      dtype: "-",
      dimensions: sectionSize(section.items),
      shape: "-",
      value: "-"
    },
    children: valueToNodes(section.items, key)
  };
}

function valueToNodes(value, key) {
  if (Array.isArray(value)) {
    return value.map((item, index) => recordToNode(item, `${key}:${index}`, item.name || String(index)));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).map(([name, item]) => scalarNode(`${key}:${name}`, name, "item", item));
  }
  if (value === undefined || value === null) return [];
  return [scalarNode(`${key}:value`, "value", "item", value)];
}

function recordToNode(record, key, fallbackName) {
  const attrChildren = isPlainObject(record.attributes)
    ? Object.entries(record.attributes).map(([name, value]) => scalarNode(`${key}:attr:${name}`, name, "attribute", value))
    : [];

  return {
    key,
    data: {
      name: record.name || fallbackName,
      kind: "record",
      dtype: record.dtype || "-",
      dimensions: formatList(record.dimensions),
      shape: formatList(record.shape, " x "),
      value: "-"
    },
    children: attrChildren
  };
}

function scalarNode(key, name, kind, value) {
  return {
    key,
    data: {
      name,
      kind,
      dtype: "-",
      dimensions: "-",
      shape: "-",
      value: String(value ?? "")
    }
  };
}

function sectionSize(value) {
  if (Array.isArray(value)) return `${value.length}`;
  if (isPlainObject(value)) return `${Object.keys(value).length}`;
  return "-";
}

function isPlainObject(value) {
  return value && !Array.isArray(value) && typeof value === "object";
}

function formatList(value, separator = ", ") {
  return Array.isArray(value) && value.length ? value.join(separator) : "-";
}
</script>
