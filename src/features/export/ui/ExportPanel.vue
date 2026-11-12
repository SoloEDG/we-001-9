<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Battle, BattleEvent } from "../../../shared/types";
import { aspectPresets, type AspectId } from "../model/scene";
import { codecOptions, recorderSupported } from "../lib/codecs";
import { useVideoExport } from "../model/exporter";

const props = defineProps<{ events: BattleEvent[]; initial: Battle }>();

const start = ref(0);
const end = ref(0);
const aspect = ref<AspectId>("16:9");
const dwell = ref(900);
const codecId = ref("");

const { supported, state, exporting, start: startExport, cancel, estimateDuration } =
  useVideoExport();

codecId.value = supported[0]?.id ?? "";

watch(
  () => props.events.length,
  (len) => {
    if (len && end.value === 0) end.value = len - 1;
    start.value = Math.min(start.value, Math.max(0, len - 1));
    end.value = Math.min(end.value, Math.max(0, len - 1));
  },
  { immediate: true },
);

const selectedCodec = computed(() =>
  supported.find((c) => c.id === codecId.value),
);
const chosenMime = computed(
  () => codecOptions.find((c) => c.id === codecId.value)?.mime ?? "",
);
const mimeBlocked = computed(
  () => !!codecId.value && !supported.some((c) => c.id === codecId.value),
);
const frameCount = computed(() =>
  props.events.length && end.value >= start.value
    ? end.value - start.value + 2
    : 0,
);
// 输入框按“第 N 步”1 基数显示，内部仍使用 0 基索引
const startStep = computed({
  get: () => start.value + 1,
  set: (v: number) => (start.value = Math.max(0, v - 1)),
});
const endStep = computed({
  get: () => end.value + 1,
  set: (v: number) => (end.value = Math.max(0, v - 1)),
});
const estimatedMs = computed(() => estimateDuration(frameCount.value, dwell.value));
const progress = computed(() =>
  state.total ? Math.round((state.done / state.total) * 100) : 0,
);
const noEvents = computed(() => props.events.length === 0);

function fmt(ms: number): string {
  const s = ms / 1000;
  return s >= 60
    ? `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`
    : `${s.toFixed(1)} 秒`;
}

function clampRange() {
  const max = Math.max(0, props.events.length - 1);
  start.value = Math.max(0, Math.min(start.value, max));
  end.value = Math.max(start.value, Math.min(end.value, max));
}

async function exportVideo() {
  if (!selectedCodec.value || exporting.value || noEvents.value) return;
  clampRange();
  await startExport({
    events: props.events,
    initial: props.initial,
    start: start.value,
    end: end.value,
    aspect: aspect.value,
    dwellMs: dwell.value,
    codec: selectedCodec.value,
  });
}
</script>

<template>
  <section class="panel export-panel">
    <div class="eyebrow">05 / VIDEO EXPORT</div>
    <h3>
      影像导出
      <small>离屏渲染固定快照 · 不录制当前界面</small>
    </h3>

    <p v-if="!recorderSupported()" class="export-alert">
      当前浏览器不支持 MediaRecorder 视频编码，无法导出视频；记录导出仍可使用。
    </p>
    <p v-else-if="!supported.length" class="export-alert">
      未检测到可用的视频编码，请升级浏览器或改用桌面端 Chrome / Edge / Firefox。
    </p>

    <template v-else>
      <div class="export-field">
        <label>战斗步骤区间（共 {{ events.length }} 步）</label>
        <div class="range-row">
          <span>第</span>
          <input
            v-model.number="startStep"
            type="number"
            min="1"
            :max="events.length"
            :disabled="exporting || noEvents"
            @change="clampRange"
          />
          <span>步 至 第</span>
          <input
            v-model.number="endStep"
            type="number"
            min="1"
            :max="events.length"
            :disabled="exporting || noEvents"
            @change="clampRange"
          />
          <span>步</span>
        </div>
        <p v-if="noEvents" class="export-hint">暂无战斗记录，先在实战中执行行动。</p>
      </div>

      <div class="export-field">
        <label for="export-aspect">画幅</label>
        <select id="export-aspect" v-model="aspect" :disabled="exporting">
          <option v-for="p in aspectPresets" :key="p.id" :value="p.id">
            {{ p.label }}
          </option>
        </select>
      </div>

      <div class="export-field">
        <label for="export-dwell">每步停留时间</label>
        <div class="range-row">
          <input
            id="export-dwell"
            v-model.number="dwell"
            type="range"
            min="400"
            max="3000"
            step="100"
            :disabled="exporting"
          />
          <b>{{ (dwell / 1000).toFixed(1) }} 秒/步</b>
        </div>
      </div>

      <div class="export-field">
        <label for="export-codec">目标编码</label>
        <select id="export-codec" v-model="codecId" :disabled="exporting">
          <option v-for="c in codecOptions" :key="c.id" :value="c.id">
            {{ c.label }}{{ supported.some((s) => s.id === c.id) ? "" : "（本机不支持）" }}
          </option>
        </select>
        <p v-if="mimeBlocked" class="export-alert">
          浏览器不支持该目标编码，请改选
          <b>{{ supported[0]?.label }}</b>
          等替代格式后再导出。
        </p>
        <p v-else class="export-hint">
          当前编码：{{ chosenMime }}
        </p>
      </div>

      <div class="export-estimate">
        <span>预计时长</span>
        <b>{{ noEvents ? "—" : fmt(estimatedMs) }}</b>
        <small>{{ frameCount }} 个画面 · 含开场帧</small>
      </div>

      <div v-if="state.phase === 'recording'" class="export-progress">
        <div class="progress-head">
          <span>导出进度 {{ progress }}%</span>
          <span>{{ state.done }}/{{ state.total }} 帧</span>
        </div>
        <div class="progress-track">
          <i :style="{ width: progress + '%' }" />
        </div>
        <p class="export-hint">{{ state.message }}</p>
        <p class="export-hint">已用时 {{ fmt(state.elapsedMs) }} ｜ 渲染期间可正常切换选中角色与回放进度，不影响成片</p>
        <button class="export-cancel" @click="cancel">取消导出并释放资源</button>
      </div>

      <template v-else>
        <button
          class="primary export-go"
          :disabled="noEvents || mimeBlocked || exporting"
          @click="exportVideo"
        >
          开始导出视频 ↓
        </button>
        <p
          v-if="state.phase === 'done'"
          class="export-result ok"
          role="status"
        >
          ✓ {{ state.message }}（用时 {{ fmt(state.elapsedMs) }}）
        </p>
        <p
          v-else-if="state.phase === 'cancelled'"
          class="export-result warn"
          role="status"
        >
          ◼ {{ state.message }}
        </p>
        <p v-else-if="state.phase === 'error'" class="export-result err" role="alert">
          ✕ {{ state.message }}
        </p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.export-panel select,
.export-panel input[type="number"] {
  width: 100%;
  background: #202c29;
  border: 1px solid #34423c;
  border-radius: 4px;
  color: #d6dedb;
  padding: 8px 10px;
  font: inherit;
}
.export-field {
  margin-bottom: 14px;
}
.export-field > label {
  display: block;
  font-size: 10px;
  letter-spacing: 1px;
  color: #8da18f;
  margin-bottom: 6px;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #8fa095;
}
.range-row input[type="number"] {
  width: 64px;
}
.range-row input[type="range"] {
  flex: 1;
  accent-color: #c7b679;
}
.range-row b {
  color: #d4c08b;
  font-size: 11px;
  white-space: nowrap;
}
.export-hint {
  margin: 6px 0 0;
  font-size: 10px;
  color: #7c9789;
  line-height: 1.6;
}
.export-alert {
  margin: 8px 0;
  font-size: 11px;
  color: #e0a08b;
  line-height: 1.7;
}
.export-estimate {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  border: 1px solid #364539;
  background: #1c2921;
  padding: 12px 14px;
  margin: 6px 0 14px;
}
.export-estimate span {
  font-size: 10px;
  letter-spacing: 1px;
  color: #8da18f;
}
.export-estimate b {
  font-size: 18px;
  color: #e2c47d;
}
.export-estimate small {
  grid-column: 1/-1;
  margin-top: 4px;
  font-size: 10px;
  color: #7c9789;
}
.export-go {
  width: 100%;
}
.export-progress {
  border: 1px solid #485342;
  background: #1c2921;
  padding: 14px;
}
.progress-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #d4c08b;
}
.progress-track {
  height: 6px;
  background: #34433a;
  margin: 10px 0;
  overflow: hidden;
}
.progress-track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #86a079, #d9bc76);
  transition: width 0.2s ease;
}
.export-cancel {
  width: 100%;
  margin-top: 10px;
  border-color: #7a4a42;
  color: #e0a08b;
}
.export-result {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.7;
  word-break: break-all;
}
.export-result.ok {
  color: #9fc7a4;
}
.export-result.warn {
  color: #d9bc76;
}
.export-result.err {
  color: #e0a08b;
}
</style>
