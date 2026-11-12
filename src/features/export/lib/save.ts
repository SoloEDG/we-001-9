/** 仅在完整成功时触发浏览器下载；取消或失败不会产生任何文件。 */
export function saveBlob(blob: Blob, filename: string): void {
  if (blob.size === 0) throw new Error("编码结果为空，已放弃保存");
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}
