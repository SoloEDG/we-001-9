import { onUnmounted, reactive, ref } from "vue";
import type { Battle, BattleEvent } from "../../../shared/types";
import {
  aspectPresets,
  buildFrames,
  drawScene,
  type AspectId,
  type ExportFrame,
} from "./scene";
import { recorderSupported, supportedCodecs, type CodecOption } from "../lib/codecs";
import { saveBlob } from "../lib/save";

export type ExportPhase = "idle" | "recording" | "done" | "error" | "cancelled";

export interface ExportOptions {
  events: BattleEvent[];
  initial: Battle;
  start: number;
  end: number;
  aspect: AspectId;
  dwellMs: number;
  codec: CodecOption;
}

export interface ExportState {
  phase: ExportPhase;
  total: number;
  done: number;
  message: string;
  elapsedMs: number;
  outputName: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useVideoExport() {
  const supported = supportedCodecs();
  const state = reactive<ExportState>({
    phase: "idle",
    total: 0,
    done: 0,
    message: "",
    elapsedMs: 0,
    outputName: "",
  });
  const exporting = ref(false);

  let cancelled = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let chunks: Blob[] = [];
  let ticker: ReturnType<typeof setInterval> | undefined;

  /** 预计成片时长：首帧引导 + 每个历史步骤停留 dwellMs。 */
  function estimateDuration(frameCount: number, dwellMs: number): number {
    return Math.max(0, frameCount * dwellMs);
  }

  function release() {
    if (ticker) clearInterval(ticker);
    ticker = undefined;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* 已停止则忽略 */
      }
    }
    recorder = null;
    // 释放离屏画布与绘制缓冲
    canvas
      ?.getContext("2d")
      ?.clearRect(0, 0, canvas.width, canvas.height);
    canvas = null;
    chunks = [];
    exporting.value = false;
  }

  function cancel() {
    if (state.phase !== "recording") return;
    cancelled = true;
  }

  onUnmounted(() => {
    cancelled = true;
    release();
  });

  async function start(options: ExportOptions): Promise<void> {
    if (exporting.value) return;
    if (!recorderSupported()) {
      state.phase = "error";
      state.message = "当前浏览器不支持画布视频录制，请更换最新版 Chrome / Edge / Firefox。";
      return;
    }
    if (!supported.some((c) => c.mime === options.codec.mime)) {
      state.phase = "error";
      state.message =
        "目标编码不受当前浏览器支持，请在导出面板改选推荐的替代格式。";
      return;
    }
    if (options.start < 0 || options.end < options.start || !options.events.length) {
      state.phase = "error";
      state.message = "请先选择有效的战斗步骤区间。";
      return;
    }

    const preset = aspectPresets.find((p) => p.id === options.aspect)!;
    const dwell = options.dwellMs;

    cancelled = false;
    exporting.value = true;
    Object.assign(state, {
      phase: "recording",
      total: 0,
      done: 0,
      message: "正在固化历史快照……",
      elapsedMs: 0,
      outputName: "",
    });

    const startedAt = Date.now();
    ticker = setInterval(() => {
      state.elapsedMs = Date.now() - startedAt;
    }, 200);

    try {
      // 固化历史快照：此后界面切换选中角色或拖动回放进度都不会改写视频内容
      const frames: ExportFrame[] = buildFrames(
        options.events,
        options.start,
        options.end,
        options.initial,
      );
      state.total = frames.length;
      // 等待界面字体就绪，避免离屏绘制回退到默认字体
      if (document.fonts?.ready) await document.fonts.ready;

      canvas = document.createElement("canvas");
      const pushFrame = (index: number) => {
        drawScene(
          canvas!,
          frames[index]!,
          preset.width,
          preset.height,
          index,
          frames.length,
        );
        const track = stream!.getVideoTracks()[0] as
          | (MediaStreamTrack & { requestFrame?: () => void })
          | undefined;
        track?.requestFrame?.();
      };

      // 先绘制首帧再开流，保证录制器拿到的第一帧完整
      drawScene(canvas, frames[0]!, preset.width, preset.height, 0, frames.length);

      const probe = canvas.captureStream(0);
      const manualFrame =
        typeof (
          probe.getVideoTracks()[0] as
            | (MediaStreamTrack & { requestFrame?: () => void })
            | undefined
        )?.requestFrame === "function";
      probe.getTracks().forEach((t) => t.stop());
      stream = manualFrame
        ? canvas.captureStream(0)
        : canvas.captureStream(Math.max(1, Math.round(1000 / dwell)));

      chunks = [];
      recorder = new MediaRecorder(stream, {
        mimeType: options.codec.mime,
        videoBitsPerSecond: 4_000_000,
      });
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      const finished = new Promise<void>((resolve, reject) => {
        if (!recorder) return reject(new Error("录制器初始化失败"));
        recorder.onstop = () => resolve();
        recorder.onerror = () =>
          reject(new Error("视频编码过程中发生错误，导出已中止"));
      });
      // 立即登记处理，避免 reject 早于下方 await 时触发 unhandledrejection
      finished.catch(() => {});

      recorder.start(250);
      // 给编码器一个启动间隔，避免首个 requestFrame 丢失
      await sleep(60);

      for (let i = 0; i < frames.length; i++) {
        if (cancelled) break;
        if (i > 0) pushFrame(i);
        state.done = i + 1;
        state.message = `渲染第 ${i + 1} / ${frames.length} 帧（${frames[i]!.step} ${frames[i]!.title}）`;
        // 每步停留固定时长；可被取消打断
        const waitUntil = Date.now() + dwell;
        while (Date.now() < waitUntil) {
          if (cancelled) break;
          await sleep(Math.min(60, waitUntil - Date.now()));
        }
      }

      if (cancelled) {
        release();
        Object.assign(state, {
          phase: "cancelled",
          message: "导出已取消，绘制资源已释放，未生成任何文件。",
          elapsedMs: Date.now() - startedAt,
        });
        return;
      }

      recorder.stop();
      await finished;
      const blob = new Blob(chunks, { type: options.codec.mime.split(";")[0] });
      if (blob.size === 0) throw new Error("编码结果为空");

      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-");
      const filename = `灰烬渡口-战斗影像-${options.start + 1}-${options.end + 1}-${stamp}.${options.codec.ext}`;
      // 原子保存：只有完整 Blob 才会触发下载，失败/取消都不会留下半成品文件
      saveBlob(blob, filename);

      const tracks = stream.getTracks();
      tracks.forEach((t) => t.stop());
      Object.assign(state, {
        phase: "done",
        done: frames.length,
        message: `导出完成：${filename}`,
        elapsedMs: Date.now() - startedAt,
        outputName: filename,
      });
      release();
    } catch (e) {
      // 失败时只清理导出资源，战斗数据与当前浏览位置完全不动
      release();
      Object.assign(state, {
        phase: "error",
        message: `${(e as Error).message}；战斗记录与当前回放位置已保留。`,
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  return {
    supported,
    state,
    exporting,
    start,
    cancel,
    estimateDuration,
  };
}
