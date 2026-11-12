import type {
  Battle,
  BattleEvent,
  Point,
  Unit,
} from "../../../shared/types";
import { clone, key } from "../../../shared/document";
import { terrainRules } from "../../terrain/lib/cost";
import { professions } from "../../roster/model/professions";
import { statusNames } from "../../roster/lib/status";

/** 可选画幅：label 供界面选择，width/height 为导出画布的逻辑像素。 */
export const aspectPresets = [
  { id: "16:9", label: "横版 16:9 · 1280×720", width: 1280, height: 720 },
  { id: "9:16", label: "竖版 9:16 · 720×1280", width: 720, height: 1280 },
  { id: "1:1", label: "方形 1:1 · 960×960", width: 960, height: 960 },
  { id: "4:3", label: "经典 4:3 · 1024×768", width: 1024, height: 768 },
] as const;

export type AspectId = (typeof aspectPresets)[number]["id"];

export interface HpCue {
  unitId: string;
  text: string;
  kind: "damage" | "heal";
}

/** 一个时间轴帧：固定的战斗快照 + 同帧展示的移动路径与生命提示。 */
export interface ExportFrame {
  battle: Battle;
  event: BattleEvent | null;
  step: string;
  title: string;
  path: Point[];
  cues: HpCue[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  header: Rect;
  map: Rect;
  order: Rect;
  roster: Rect;
  caption: Rect;
  cell: number;
}

const TERRAIN_FILL: Record<string, string> = {
  plain: "#3c5036",
  forest: "#263e2a",
  water: "#2e5051",
  ridge: "#66614a",
  wall: "#30342e",
};
const LINE = "#546043";
const FONT_STACK = '"Space Grotesk","Noto Sans SC",sans-serif';

export function hpCues(event: BattleEvent): HpCue[] {
  const cues: HpCue[] = [];
  for (const after of event.after.units) {
    const before = event.before.units.find((u) => u.id === after.id);
    if (!before || before.hp === after.hp) continue;
    const delta = after.hp - before.hp;
    cues.push({
      unitId: after.id,
      text: delta > 0 ? `+${delta}` : `${delta}`,
      kind: delta > 0 ? "heal" : "damage",
    });
  }
  return cues;
}

/** 将选定的历史事件区间固化为不可变的时间轴帧，导出期间不受界面状态影响。 */
export function buildFrames(
  events: BattleEvent[],
  start: number,
  end: number,
  initial: Battle,
): ExportFrame[] {
  const picked = events.slice(start, end + 1);
  const frames: ExportFrame[] = [
    {
      battle: clone(start === 0 ? initial : events[start]!.before),
      event: null,
      step: "00",
      title: "战斗开始",
      path: [],
      cues: [],
    },
  ];
  picked.forEach((event) => {
    frames.push({
      battle: clone(event.after),
      event: clone(event),
      step: String(event.id).padStart(2, "0"),
      title: event.label,
      path: clone(event.path ?? []),
      cues: hpCues(event),
    });
  });
  return frames;
}

function computeLayout(width: number, height: number): Layout {
  const pad = Math.round(width * 0.025);
  const headerH = Math.round(height * 0.085);
  const captionH = Math.round(height * 0.075);
  const top = pad * 2 + headerH;
  const bottom = height - pad - captionH - pad;
  const header = { x: pad, y: pad, w: width - pad * 2, h: headerH };

  // 字幕：两种方向都作为独立底栏，避免切开生命列表
  const caption = {
    x: pad,
    y: height - pad - captionH,
    w: width - pad * 2,
    h: captionH,
  };

  if (height > width) {
    // 竖版：地图 → 行动顺序 → 生命状态，纵向堆叠
    const mapW = width - pad * 2;
    const cell = Math.floor(mapW / 12);
    const map = { x: pad, y: top, w: cell * 12, h: cell * 8 };
    const orderH = Math.round(height * 0.095);
    const order = {
      x: pad,
      y: map.y + map.h + pad,
      w: width - pad * 2,
      h: orderH,
    };
    const roster = {
      x: pad,
      y: order.y + order.h + pad,
      w: width - pad * 2,
      h: bottom - (order.y + order.h + pad),
    };
    return { header, map, order, roster, caption, cell };
  }

  // 横版：左侧地图 + 下方行动顺序，右侧生命列贯通，底部全宽字幕
  const orderH = Math.round(height * 0.1);
  const leftW = Math.round((width - pad * 3) * 0.68);
  const cell = Math.floor(Math.min(leftW / 12, (bottom - top - orderH - pad) / 8));
  const map = { x: pad, y: top, w: cell * 12, h: cell * 8 };
  const order = {
    x: pad,
    y: map.y + map.h + pad,
    w: cell * 12,
    h: orderH,
  };
  const sideX = pad * 2 + cell * 12;
  const roster = {
    x: sideX,
    y: top,
    w: width - pad - sideX,
    h: bottom - top,
  };
  return { header, map, order, roster, caption, cell };
}

function rounded(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number,
): void {
  const rr = Math.min(radius, r.w / 2, r.h / 2);
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, rr);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight: number | string = 400,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

function panel(ctx: CanvasRenderingContext2D, r: Rect): void {
  rounded(ctx, r, 8);
  ctx.fillStyle = "#18231f";
  ctx.fill();
  ctx.strokeStyle = "#34433a";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function unitGlyph(job: Unit["job"]): string {
  return job === "guard"
    ? "♜"
    : job === "ranger"
      ? "➶"
      : job === "mage"
        ? "✦"
        : "✚";
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  frame: ExportFrame,
  l: Layout,
): void {
  const r = l.header;
  panel(ctx, r);
  const mark = Math.round(r.h * 0.62);
  rounded(
    ctx,
    { x: r.x + 14, y: r.y + (r.h - mark) / 2, w: mark, h: mark },
    4,
  );
  ctx.fillStyle = "#c6ad70";
  ctx.fill();
  text(
    ctx,
    "⌘",
    r.x + 14 + mark / 2,
    r.y + r.h / 2 + 1,
    mark * 0.62,
    "#17241c",
    700,
    "center",
  );
  text(
    ctx,
    "灰烬渡口 · 战斗影像",
    r.x + 14 + mark + 14,
    r.y + r.h * 0.42,
    Math.round(r.h * 0.3),
    "#d6dedb",
    700,
  );
  text(
    ctx,
    `步骤 ${frame.step}`,
    r.x + 14 + mark + 14,
    r.y + r.h * 0.72,
    Math.round(r.h * 0.17),
    "#809087",
  );
  const b = frame.battle;
  text(
    ctx,
    b.ended ? "战斗结束" : `第 ${b.round} 回合`,
    r.x + r.w - 16,
    r.y + r.h * 0.42,
    Math.round(r.h * 0.28),
    "#c9bc8e",
    700,
    "right",
  );
  text(
    ctx,
    `${b.units.filter((u) => u.hp > 0).length} 名存活`,
    r.x + r.w - 16,
    r.y + r.h * 0.74,
    Math.round(r.h * 0.17),
    "#809087",
    400,
    "right",
  );
}

function drawMap(
  ctx: CanvasRenderingContext2D,
  frame: ExportFrame,
  l: Layout,
): void {
  const r = l.map;
  panel(ctx, r);
  const inner = { x: r.x + 10, y: r.y + 10, w: r.w - 20, h: r.h - 20 };
  const cell = Math.min(
    Math.floor(inner.w / 12),
    Math.floor(inner.h / 8),
  );
  const ox = inner.x + (inner.w - cell * 12) / 2;
  const oy = inner.y + (inner.h - cell * 8) / 2;
  const b = frame.battle;

  // 地形（地图变化随快照呈现）
  for (const tile of b.tiles) {
    const x = ox + tile.x * cell;
    const y = oy + tile.y * cell;
    ctx.fillStyle =
      TERRAIN_FILL[tile.terrain] ??
      ((tile.x + tile.y) % 2 === 0 ? "#3c5036" : "#40533a");
    ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    text(
      ctx,
      terrainRules[tile.terrain].glyph,
      x + cell / 2,
      y + cell / 2,
      Math.round(cell * 0.42),
      "rgba(156,163,118,0.4)",
      400,
      "center",
    );
    text(
      ctx,
      `${tile.x + 1}·${tile.y + 1}`,
      x + 5,
      y + cell - 8,
      Math.max(8, Math.round(cell * 0.13)),
      "rgba(210,212,174,0.35)",
    );
  }

  // 移动路径（与该步伤害提示同帧出现，共用同一时间轴）
  if (frame.path.length > 1) {
    ctx.strokeStyle = "#d9bc76";
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.setLineDash([cell * 0.22, cell * 0.16]);
    ctx.beginPath();
    frame.path.forEach((p, i) => {
      const cx = ox + p.x * cell + cell / 2;
      const cy = oy + p.y * cell + cell / 2;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    const start = frame.path[0]!;
    const end = frame.path[frame.path.length - 1]!;
    [start, end].forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(
        ox + p.x * cell + cell / 2,
        oy + p.y * cell + cell / 2,
        cell * 0.12,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = i === 0 ? "#9fd3ce" : "#e2c47d";
      ctx.fill();
    });
  }

  // 技能连线：施法者 → 目标
  if (frame.event && frame.event.kind === "skill") {
    const actor = b.units.find((u) => u.id === frame.event!.actor);
    const cueUnit = frame.cues[0]
      ? b.units.find((u) => u.id === frame.cues[0]!.unitId)
      : undefined;
    if (actor && cueUnit && actor.id !== cueUnit.id) {
      ctx.strokeStyle = "rgba(213,172,115,0.85)";
      ctx.lineWidth = Math.max(1.5, cell * 0.06);
      ctx.setLineDash([cell * 0.16, cell * 0.12]);
      ctx.beginPath();
      ctx.moveTo(ox + actor.x * cell + cell / 2, oy + actor.y * cell + cell / 2);
      ctx.lineTo(
        ox + cueUnit.x * cell + cell / 2,
        oy + cueUnit.y * cell + cell / 2,
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 单位与生命条
  for (const u of b.units) {
    const x = ox + u.x * cell;
    const y = oy + u.y * cell;
    const inset = cell * 0.12;
    const pr: Rect = {
      x: x + inset,
      y: y + inset,
      w: cell - inset * 2,
      h: cell - inset * 2,
    };
    rounded(ctx, pr, Math.max(3, cell * 0.08));
    ctx.fillStyle = u.team === "azure" ? "#203a3a" : "#633f32";
    ctx.fill();
    ctx.strokeStyle = u.team === "azure" ? "#b0d3c8" : "#c9926c";
    ctx.lineWidth = u.id === b.active ? 2.5 : 1;
    ctx.stroke();
    if (u.id === b.active && u.hp > 0) {
      ctx.save();
      ctx.shadowColor = "#e2c47d";
      ctx.shadowBlur = cell * 0.18;
      rounded(ctx, pr, Math.max(3, cell * 0.08));
      ctx.strokeStyle = "#e2c47d";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    if (u.hp <= 0) {
      ctx.globalAlpha = 0.35;
    }
    text(
      ctx,
      unitGlyph(u.job),
      x + cell / 2,
      y + cell / 2 - cell * 0.05,
      cell * 0.4,
      u.team === "azure" ? "#d3e5db" : "#e5ba8b",
      500,
      "center",
    );
    ctx.globalAlpha = 1;
    // 生命条
    const barW = pr.w;
    const barH = Math.max(3, cell * 0.07);
    const barY = pr.y + pr.h - barH - 2;
    ctx.fillStyle = "#14201a";
    ctx.fillRect(pr.x, barY, barW, barH);
    ctx.fillStyle = u.hp > 0 ? "#94b89b" : "#7a4a42";
    ctx.fillRect(pr.x, barY, barW * Math.max(0, u.hp / u.maxHp), barH);
  }

  // 伤害 / 治疗提示，与移动路径绘制在同一帧
  frame.cues.forEach((cue) => {
    const u = b.units.find((v) => v.id === cue.unitId);
    if (!u) return;
    const cx = ox + u.x * cell + cell / 2;
    const cy = oy + u.y * cell + cell * 0.18;
    const size = Math.max(13, cell * 0.3);
    ctx.font = `700 ${size}px ${FONT_STACK}`;
    const w = ctx.measureText(cue.text).width + size;
    rounded(ctx, { x: cx - w / 2, y: cy - size * 0.75, w, h: size * 1.35 }, 5);
    ctx.fillStyle = cue.kind === "heal" ? "#2f5d43" : "#6e352c";
    ctx.fill();
    ctx.strokeStyle = cue.kind === "heal" ? "#9fd3a8" : "#e0a08b";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(
      ctx,
      cue.text,
      cx,
      cy,
      size,
      cue.kind === "heal" ? "#bfe8c4" : "#f2c3b2",
      700,
      "center",
    );
  });
}

function drawOrder(
  ctx: CanvasRenderingContext2D,
  frame: ExportFrame,
  l: Layout,
): void {
  const r = l.order;
  panel(ctx, r);
  text(ctx, "行动顺序", r.x + 14, r.y + 16, 11, "#8da18f", 500);
  const b = frame.battle;
  const chips = b.queue.slice(0, 8);
  const chipW = (r.w - 28 - (chips.length - 1) * 8) / Math.max(1, chips.length);
  const chipH = r.h - 40;
  chips.forEach((id, i) => {
    const u = b.units.find((v) => v.id === id);
    if (!u) return;
    const cr: Rect = {
      x: r.x + 14 + i * (chipW + 8),
      y: r.y + 30,
      w: Math.min(chipW, 118),
      h: chipH,
    };
    rounded(ctx, cr, 4);
    ctx.fillStyle = i === 0 ? "#36493c" : "#1f2d27";
    ctx.fill();
    ctx.strokeStyle = i === 0 ? "#b7bb81" : "#3a514a";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(
      ctx,
      String(i + 1).padStart(2, "0"),
      cr.x + 8,
      cr.y + 12,
      9,
      "#789188",
      400,
    );
    text(
      ctx,
      u.name,
      cr.x + cr.w / 2,
      cr.y + cr.h * 0.48,
      Math.min(13, cr.w * 0.2),
      i === 0 ? "#e4d6a8" : "#a3b5ab",
      i === 0 ? 700 : 400,
      "center",
    );
    text(
      ctx,
      `${u.speed}`,
      cr.x + cr.w / 2,
      cr.y + cr.h * 0.78,
      10,
      "#90aaa0",
      500,
      "center",
    );
  });
}

function drawRoster(
  ctx: CanvasRenderingContext2D,
  frame: ExportFrame,
  l: Layout,
): void {
  const r = l.roster;
  panel(ctx, r);
  const padX = 16;
  const titleH = Math.round(r.h * 0.07);
  text(ctx, "生命状态", r.x + padX, r.y + titleH * 0.62, 11, "#8da18f", 500);
  const b = frame.battle;
  const listTop = r.y + titleH + 10;
  const listH = r.h - (titleH + 10) - 12;
  const rowH = listH / b.units.length;
  const av = Math.min(26, Math.max(18, rowH * 0.52));
  const barW = r.w * 0.3;
  const barX = r.x + r.w - padX - 70 - barW;
  b.units.forEach((u, i) => {
    const y = listTop + i * rowH + rowH / 2;
    const dead = u.hp <= 0;
    ctx.globalAlpha = dead ? 0.4 : 1;
    rounded(ctx, { x: r.x + padX - 4, y: y - av / 2, w: av, h: av }, 4);
    ctx.fillStyle = u.team === "azure" ? "#304a49" : "#503b30";
    ctx.fill();
    text(
      ctx,
      u.name.slice(0, 1),
      r.x + padX - 4 + av / 2,
      y,
      av * 0.52,
      u.team === "azure" ? "#a3d3cc" : "#dbad90",
      500,
      "center",
    );
    const labelX = r.x + padX - 4 + av + 10;
    const st = u.statuses
      .map((s) => `${statusNames[s.kind]}${s.turns}`)
      .join(" ");
    text(
      ctx,
      u.name,
      labelX,
      y - 7,
      12,
      "#d6dedb",
      u.id === b.active ? 700 : 400,
    );
    text(
      ctx,
      st ? `${professions[u.job].name} · ${st}` : professions[u.job].name,
      labelX,
      y + 9,
      9,
      st ? "#d7c487" : "#7c9789",
    );
    ctx.fillStyle = "#34433a";
    ctx.fillRect(barX, y - 3, barW, 5);
    ctx.fillStyle = u.hp > 0 ? "#94b89b" : "#7a4a42";
    ctx.fillRect(barX, y - 3, barW * Math.max(0, u.hp / u.maxHp), 5);
    text(
      ctx,
      dead ? "阵亡" : `${u.hp}/${u.maxHp}`,
      r.x + r.w - padX,
      y,
      11,
      dead ? "#b07a6e" : "#c5d3c4",
      500,
      "right",
    );
    ctx.globalAlpha = 1;
  });
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  frame: ExportFrame,
  l: Layout,
  index: number,
  total: number,
): void {
  const r = l.caption;
  panel(ctx, r);
  text(ctx, frame.step, r.x + 16, r.y + r.h * 0.4, 16, "#d9bc76", 700);
  text(
    ctx,
    frame.title,
    r.x + 52,
    r.y + r.h * 0.4,
    13,
    "#e0dcc6",
    500,
  );
  const cueText = frame.cues
    .map((c) => {
      const u = frame.battle.units.find((v) => v.id === c.unitId);
      return u ? `${u.name} ${c.text}` : c.text;
    })
    .join("　");
  if (cueText) {
    text(ctx, cueText, r.x + 52, r.y + r.h * 0.74, 11, "#d9a78f", 500);
  }
  text(
    ctx,
    `${index + 1}/${total}`,
    r.x + r.w - 14,
    r.y + r.h * 0.5,
    11,
    "#809087",
    500,
    "right",
  );
}

/** 将一个固定快照帧完整绘制到目标画布（可离屏），与界面 DOM 完全解耦。 */
export function drawScene(
  canvas: HTMLCanvasElement,
  frame: ExportFrame,
  width: number,
  height: number,
  index: number,
  total: number,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建离屏绘制上下文");
  const layout = computeLayout(width, height);
  ctx.fillStyle = "#101817";
  ctx.fillRect(0, 0, width, height);
  drawHeader(ctx, frame, layout);
  drawMap(ctx, frame, layout);
  drawOrder(ctx, frame, layout);
  drawRoster(ctx, frame, layout);
  drawCaption(ctx, frame, layout, index, total);
}
