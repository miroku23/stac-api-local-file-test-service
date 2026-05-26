<template>
  <section
    class="satellite-timeline geo-panel"
    :class="{ open }"
  >
    <button class="timeline-toggle" type="button" @click="open = !open">
      <span class="material-symbols-rounded icon">{{ open ? "keyboard_arrow_down" : "timeline" }}</span>{{ open ? "hide timeline" : "timeline" }}
    </button>
    <div
      v-show="open"
      class="timeline-body"
      @pointerdown.stop="onPointerDown"
      @pointermove.stop="onPointerMove"
      @pointerup.stop="onPointerUp"
      @pointercancel.stop="onPointerUp"
      @wheel.stop.prevent="onWheel"
    >
      <div class="timeline-toolbar">
        <label class="timeline-datetime">
          <span>Datetime {{ timeModeLabel }}</span>
          <input :value="datetimeValue" type="datetime-local" step="60" @input="setDatetimeInput" />
        </label>
        <span>{{ spanLabel }}</span>
      </div>
      <svg ref="svgRef" class="timeline-svg" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none"></svg>
    </div>
  </section>
</template>

<script setup>
import * as d3 from "d3";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { setRenderingOption, viewerState } from "../store";

const MIN_RANGE_MS = 60 * 60 * 1000;
const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;
const STEP_MS = 60 * 1000;

const open = ref(false);
const rangeMs = ref(MIN_RANGE_MS);
const timelineCenter = ref(null);
const svgRef = ref(null);
const width = ref(980);
const height = 86;
let resizeObserver = null;
const activePointers = new Map();
let pinchStart = null;
let markerDragActive = false;
const markerPreviewDate = ref(null);
let previewUpdateRaf = 0;
let pendingPreviewDate = null;

const timeMode = computed(() => viewerState.rendering.timeMode || "local");
const timeModeLabel = computed(() => timeMode.value === "utc" ? "UTC" : "Local");
const datetimeValue = computed(() => formatInputValue(markerPreviewDate.value || currentDate.value));
const currentDate = computed(() => parseTimelineDate(viewerState.rendering.datetime || "2026-04-28T18:00"));
const spanLabel = computed(() => tickConfig(rangeMs.value).label);
const centerDate = computed(() => timelineCenter.value || currentDate.value);

function parseTimelineDate(value) {
  if (value) {
    const parsed = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date("2026-04-28T18:00:00Z");
}

function toUtcInputValue(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function toLocalInputValue(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatInputValue(date) {
  return timeMode.value === "utc" ? toUtcInputValue(date) : toLocalInputValue(date);
}

function parseInputValue(value) {
  const [datePart, timePart = "00:00"] = String(value).split("T");
  const [yyyy, mm, dd] = datePart.split("-").map(Number);
  const [hh, mi] = timePart.split(":").map(Number);
  if (![yyyy, mm, dd, hh, mi].every(Number.isFinite)) return null;
  return timeMode.value === "utc"
    ? new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, 0))
    : new Date(yyyy, mm - 1, dd, hh, mi, 0);
}

function setTime(date) {
  setRenderingOption("datetime", toUtcInputValue(snapDate(date)));
}

function setTimelineInteracting(value) {
  setRenderingOption("timelineInteracting", Boolean(value));
}

function queueTimelinePreview(date) {
  const snapped = snapDate(date);
  markerPreviewDate.value = snapped;
  pendingPreviewDate = snapped;
  if (previewUpdateRaf) return;
  previewUpdateRaf = requestAnimationFrame(() => {
    previewUpdateRaf = 0;
    if (pendingPreviewDate) {
      setRenderingOption("timelinePreviewDatetime", toUtcInputValue(pendingPreviewDate));
      pendingPreviewDate = null;
    }
  });
}

function clearTimelinePreview() {
  if (previewUpdateRaf) {
    cancelAnimationFrame(previewUpdateRaf);
    previewUpdateRaf = 0;
  }
  pendingPreviewDate = null;
  markerPreviewDate.value = null;
  setRenderingOption("timelinePreviewDatetime", null);
}

function setDatetimeInput(event) {
  const value = event.target?.value;
  if (!value) return;
  const date = parseInputValue(value);
  if (date) setRenderingOption("datetime", toUtcInputValue(date));
}

function tickConfig(ms) {
  const fmt = timeMode.value === "utc" ? d3.utcFormat : d3.timeFormat;
  const hours = ms / (60 * 60 * 1000);
  if (hours <= 2) return { interval: d3.timeMinute.every(5), format: fmt("%H:%M"), label: "5m" };
  if (hours <= 6) return { interval: d3.timeMinute.every(15), format: fmt("%H:%M"), label: "15m" };
  if (hours <= 24) return { interval: d3.timeHour.every(1), format: fmt("%H:%M"), label: "1h" };
  if (hours <= 24 * 7) return { interval: d3.timeHour.every(12), format: fmt("%d %H:%M"), label: "12h" };
  if (hours <= 24 * 45) return { interval: d3.timeDay.every(2), format: fmt("%d %b"), label: "2d" };
  if (hours <= 24 * 180) return { interval: d3.timeWeek.every(1), format: fmt("%d %b"), label: "1w" };
  return { interval: d3.timeMonth.every(1), format: fmt("%b"), label: "1mo" };
}

function clampRange(ms) {
  return Math.max(MIN_RANGE_MS, Math.min(MAX_RANGE_MS, ms));
}

function snapDate(date) {
  const snapped = Math.round(date.getTime() / STEP_MS) * STEP_MS;
  return new Date(snapped);
}

function timelineMetrics() {
  const margin = { left: 0, right: 0, top: 18, bottom: 10 };
  const innerWidth = Math.max(240, width.value - margin.left - margin.right);
  const center = centerDate.value;
  const domain = [new Date(center.getTime() - rangeMs.value / 2), new Date(center.getTime() + rangeMs.value / 2)];
  const scale = d3.scaleTime().domain(domain).range([margin.left, margin.left + innerWidth]);
  return { margin, innerWidth, center, domain, scale };
}

function zoomAt(clientX, factor) {
  const rect = svgRef.value?.getBoundingClientRect();
  if (!rect) return;
  const { margin, innerWidth, scale } = timelineMetrics();
  const x = Math.max(margin.left, Math.min(margin.left + innerWidth, clientX - rect.left));
  const ratio = innerWidth > 0 ? (x - margin.left) / innerWidth : 0.5;
  const anchorTime = scale.invert(x).getTime();
  const nextRange = clampRange(rangeMs.value * factor);
  rangeMs.value = nextRange;
  timelineCenter.value = new Date(anchorTime - (ratio - 0.5) * nextRange);
}

function onWheel(event) {
  zoomAt(event.clientX, event.deltaY > 0 ? 1.25 : 0.8);
}

function onPointerDown(event) {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  event.currentTarget.setPointerCapture?.(event.pointerId);
  if (activePointers.size === 2) {
    const points = [...activePointers.values()];
    const midX = (points[0].x + points[1].x) / 2;
    const rect = svgRef.value?.getBoundingClientRect();
    const { margin, innerWidth, scale } = timelineMetrics();
    const x = rect ? Math.max(margin.left, Math.min(margin.left + innerWidth, midX - rect.left)) : margin.left + innerWidth / 2;
    pinchStart = {
      distance: pointerDistance(points),
      range: rangeMs.value,
      ratio: innerWidth > 0 ? (x - margin.left) / innerWidth : 0.5,
      anchorTime: scale.invert(x).getTime()
    };
  }
}

function onPointerMove(event) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size !== 2 || !pinchStart?.distance) return;
  event.preventDefault();
  const distance = pointerDistance([...activePointers.values()]);
  if (distance <= 0) return;
  const nextRange = clampRange(pinchStart.range * pinchStart.distance / distance);
  rangeMs.value = nextRange;
  timelineCenter.value = new Date(pinchStart.anchorTime - (pinchStart.ratio - 0.5) * nextRange);
}

function onPointerUp(event) {
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) pinchStart = null;
}

function pointerDistance(points) {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function renderTimeline() {
  if (!svgRef.value) return;
  const svg = d3.select(svgRef.value);
  svg.selectAll("*").remove();

  if (!timelineCenter.value) timelineCenter.value = currentDate.value;
  const { margin, innerWidth, center, scale } = timelineMetrics();
  const range = tickConfig(rangeMs.value);
  const axis = d3.axisTop(scale).ticks(range.interval).tickFormat(range.format).tickSize(-(height - margin.top - margin.bottom));

  const axisGroup = svg.append("g")
    .attr("class", "timeline-axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(axis);

  axisGroup.select(".domain").attr("stroke", "rgba(143, 216, 255, .34)");
  axisGroup.selectAll(".tick line").attr("stroke", "rgba(143, 216, 255, .28)");
  axisGroup.selectAll(".tick text").attr("fill", "#ffffff").attr("font-size", 10).attr("dy", -4);

  const markerX = Math.max(margin.left, Math.min(margin.left + innerWidth, scale(currentDate.value)));
  let panStart = null;

  svg.append("rect")
    .attr("class", "timeline-pan-hit")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", width.value)
    .attr("height", height)
    .attr("fill", "transparent")
    .style("cursor", "grab")
    .call(d3.drag()
      .on("start", (event) => {
        d3.select(event.sourceEvent?.target).style("cursor", "grabbing");
        panStart = {
          pointerX: event.x,
          startCenter: centerDate.value.getTime(),
          startMarkerX: markerX,
          msPerPx: rangeMs.value / Math.max(1, innerWidth)
        };
      })
      .on("drag", (event) => {
        if (!panStart) return;
        const dx = event.x - panStart.pointerX;
        timelineCenter.value = new Date(panStart.startCenter - dx * panStart.msPerPx);
      })
      .on("end", (event) => {
        d3.select(event.sourceEvent?.target).style("cursor", "grab");
        panStart = null;
      }));

  const marker = svg.append("g")
    .attr("class", "timeline-marker")
    .attr("transform", `translate(${markerX},0)`)
    .style("cursor", "ew-resize");

  marker.append("line")
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", 27)
    .attr("y2", height - margin.bottom)
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 2);

  marker.append("path")
    .attr("d", "M -10 18 L 10 18 L 0 38 Z")
    .attr("fill", "#ffffff");

  marker.append("rect")
    .attr("x", -16)
    .attr("y", 12)
    .attr("width", 32)
    .attr("height", height - 12)
    .attr("fill", "transparent");

  marker.call(d3.drag().on("drag", (event) => {
      const x = Math.max(margin.left, Math.min(margin.left + innerWidth, event.x));
      marker.attr("transform", `translate(${x},0)`);
      queueTimelinePreview(scale.invert(x));
    }).on("start", (event) => {
      markerDragActive = true;
      setTimelineInteracting(true);
      const x = Math.max(margin.left, Math.min(margin.left + innerWidth, event.x));
      marker.attr("transform", `translate(${x},0)`);
      queueTimelinePreview(scale.invert(x));
    }).on("end", (event) => {
      const x = Math.max(margin.left, Math.min(margin.left + innerWidth, event.x));
      markerDragActive = false;
      const nextDate = snapDate(scale.invert(x));
      setTime(nextDate);
      clearTimelinePreview();
      setTimelineInteracting(false);
    }));
}

function measure() {
  const parent = svgRef.value?.parentElement;
  if (!parent) return;
  width.value = Math.max(320, Math.floor(parent.clientWidth));
}

onMounted(async () => {
  await nextTick();
  measure();
  resizeObserver = new ResizeObserver(() => {
    measure();
    renderTimeline();
  });
  if (svgRef.value?.parentElement) resizeObserver.observe(svgRef.value.parentElement);
  renderTimeline();
});

onBeforeUnmount(() => {
  if (markerDragActive) {
    clearTimelinePreview();
    setTimelineInteracting(false);
  }
  if (resizeObserver) resizeObserver.disconnect();
});

watch([currentDate, centerDate, rangeMs, width, open, timeMode], () => {
  if (markerDragActive) return;
  nextTick(renderTimeline);
});
</script>
