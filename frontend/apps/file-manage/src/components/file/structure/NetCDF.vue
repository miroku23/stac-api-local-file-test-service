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

const nodes = computed(() => {
  if (!props.detail.root) return [];
  return rootChildren(props.detail.root, "root");
});

function groupToNode(group, key) {
  return {
    key,
    data: {
      name: group.path || group.name || "group",
      kind: "group",
      dtype: "-",
      dimensions: dimensionSummary(group.dimensions),
      shape: "-",
      value: "-"
    },
    children: groupChildren(group, key)
  };
}

function rootChildren(group, key) {
  return [
    ...dimensionsToSectionNodes(group.dimensions, `${key}:dimensions`),
    ...attributesToSectionNodes(group.attributes, `${key}:attributes`),
    ...variablesToSectionNodes(group.variables, `${key}:variables`),
    ...(group.groups || []).map((child, index) => groupToNode(child, `${key}:group:${child.path || index}`))
  ];
}

function groupChildren(group, key) {
  return [
    ...dimensionsToLeafNodes(group.dimensions, `${key}:dimensions`),
    ...attributesToLeafNodes(group.attributes, `${key}:attributes`),
    ...variablesToLeafNodes(group.variables, `${key}:variables`),
    ...(group.groups || []).map((child, index) => groupToNode(child, `${key}:group:${child.path || index}`))
  ];
}

function dimensionsToSectionNodes(dimensions = {}, key) {
  const entries = Object.entries(dimensions);
  if (!entries.length) return [];
  return [{
    key,
    data: {
      name: "dimensions",
      kind: "section",
      dtype: "-",
      dimensions: `${entries.length}`,
      shape: "-",
      value: summarizeObject(dimensions)
    },
    children: entries.map(([name, value]) => ({
      key: `${key}:${name}`,
      data: dimensionData(name, value)
    }))
  }];
}

function attributesToSectionNodes(attributes = {}, key) {
  const entries = Object.entries(attributes);
  if (!entries.length) return [];
  return [{
    key,
    data: {
      name: "attributes",
      kind: "section",
      dtype: "-",
      dimensions: "-",
      shape: "-",
      value: summarizeObject(attributes)
    },
    children: entries.map(([name, value]) => ({
      key: `${key}:${name}`,
      data: attributeData(name, value)
    }))
  }];
}

function variablesToSectionNodes(variables = [], key) {
  if (!variables.length) return [];
  return [{
    key,
    data: {
      name: "variables",
      kind: "section",
      dtype: "-",
      dimensions: `${variables.length}`,
      shape: "-",
      value: summarizeRecords(variables)
    },
    children: variablesToLeafNodes(variables, key)
  }];
}

function dimensionsToLeafNodes(dimensions = {}, key) {
  return Object.entries(dimensions).map(([name, value]) => ({
    key: `${key}:${name}`,
    data: dimensionData(name, value)
  }));
}

function attributesToLeafNodes(attributes = {}, key) {
  return Object.entries(attributes).map(([name, value]) => ({
    key: `${key}:${name}`,
    data: attributeData(name, value)
  }));
}

function variablesToLeafNodes(variables = [], key) {
  return variables.map((variable, index) => ({
    key: `${key}:${variable.name || index}`,
    data: variableData(variable)
  }));
}

function dimensionData(name, value) {
  return {
    name,
    kind: "dimension",
    dtype: "-",
    dimensions: "-",
    shape: "-",
    value
  };
}

function attributeData(name, value) {
  return {
    name,
    kind: "attribute",
    dtype: "-",
    dimensions: "-",
    shape: "-",
    value
  };
}

function variableData(variable) {
  return {
    name: variable.name,
    kind: "variable",
    dtype: variable.dtype || "-",
    dimensions: formatList(variable.dimensions),
    shape: formatList(variable.shape, " x "),
    value: "-"
  };
}

function dimensionSummary(dimensions = {}) {
  const entries = Object.entries(dimensions);
  if (!entries.length) return "-";
  return entries.map(([name, value]) => `${name}: ${value}`).join(", ");
}

function formatList(value, separator = ", ") {
  return Array.isArray(value) && value.length ? value.join(separator) : "-";
}

function summarizeObject(value = {}) {
  const entries = Object.entries(value);
  if (!entries.length) return "-";
  return entries
    .slice(0, 3)
    .map(([name, item]) => `${name}: ${item}`)
    .join(", ");
}

function summarizeRecords(records = []) {
  if (!records.length) return "-";
  return records
    .slice(0, 3)
    .map((item) => item.name || item.path || "-")
    .join(", ");
}
</script>
