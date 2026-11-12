export interface CodecOption {
  id: string;
  label: string;
  mime: string;
  ext: string;
}

/** 候选编码按偏好排序，运行时再用 isTypeSupported 过滤浏览器实际支持的项。 */
export const codecOptions: CodecOption[] = [
  {
    id: "mp4",
    label: "MP4 · H.264（通用）",
    mime: "video/mp4;codecs=avc1.42E01E",
    ext: "mp4",
  },
  {
    id: "mp4-baseline",
    label: "MP4 · H.264 基线",
    mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    ext: "mp4",
  },
  {
    id: "webm-vp9",
    label: "WebM · VP9（Chrome/Edge/Firefox）",
    mime: "video/webm;codecs=vp9",
    ext: "webm",
  },
  {
    id: "webm-vp8",
    label: "WebM · VP8（兼容性最广）",
    mime: "video/webm;codecs=vp8",
    ext: "webm",
  },
  {
    id: "webm",
    label: "WebM（默认编码）",
    mime: "video/webm",
    ext: "webm",
  },
];

export function recorderSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

/** 返回当前浏览器真正可编码的格式列表（去重，按 codecOptions 偏好排序）。 */
export function supportedCodecs(): CodecOption[] {
  if (!recorderSupported() || typeof MediaRecorder.isTypeSupported !== "function")
    return [];
  const picked: CodecOption[] = [];
  const seen = new Set<string>();
  for (const option of codecOptions) {
    try {
      if (!MediaRecorder.isTypeSupported(option.mime)) continue;
      const sig = `${option.ext}:${option.mime}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      picked.push(option);
    } catch {
      /* 个别浏览器对异常 mime 串会抛错，按不支持处理 */
    }
  }
  return picked;
}
