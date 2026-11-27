const CONFIG = {
  "owner": "",
  "repo": "dabang-data",
  "branch": "main",
  "token": "",
  "appUrl": ""
};
// 다방 Dabang — widget Scriptable: hiện 1 cụm từ / ngữ pháp / quán dụng ngữ / từ đã ghi, ngẫu nhiên.
// Dán cả file này vào 1 script mới trong app Scriptable (nút “Sao chép mã widget” trong Cài đặt đã điền sẵn CONFIG).
// Màn hình khoá: giữ màn hình khoá → Tuỳ chỉnh → thêm widget → Scriptable (ô chữ nhật) → chọn script này.

// địa chỉ gốc app (bỏ ?… #… index.html nếu lỡ dính vào)
const BASE = (CONFIG.appUrl || "").split("#")[0].split("?")[0].replace(/index\.html$/, "").replace(/\/?$/, "/");
const LOCK = config.widgetFamily === "accessoryRectangular";
const fm = FileManager.local();
const dir = fm.joinPath(fm.documentsDirectory(), "dabang");
if (!fm.fileExists(dir)) fm.createDirectory(dir);
const P = n => fm.joinPath(dir, n);

async function cached(name, maxAgeMin, fetcher) {
  const f = P(name);
  const read = () => { try { return fm.fileExists(f) ? JSON.parse(fm.readString(f)) : null; } catch (e) { return null; } };
  let age = 1e9;
  try { if (fm.fileExists(f)) age = (Date.now() - fm.modificationDate(f).getTime()) / 60000; } catch (e) {}
  if (age < maxAgeMin) { const d = read(); if (d) return d; }
  try {
    const data = await fetcher();
    try { fm.writeString(f, JSON.stringify(data)); } catch (e) {}
    return data;
  } catch (e) {
    return read();
  }
}

async function loadTopik() {
  if (!CONFIG.appUrl) return null;
  // chỉ giữ các trường widget cần → file cache nhỏ, widget màn hình khoá (ít bộ nhớ) đọc nhanh
  return cached("topik-slim-v2.json", 24 * 60, async () => {
    const r = new Request(BASE + "topik.json");
    r.timeoutInterval = 20;
    const d = await r.loadJSON(), out = {};
    for (const k of ["vocab", "grammar", "idiom"]) out[k] = (d[k] || []).map(x => ({ ko: x.ko, vi: x.vi, hv: x.hv || "", ex: x.ex || "", exvi: x.exvi || "", src: x.src || "" }));
    return out;
  });
}
async function loadNotes() {
  if (!CONFIG.owner || !CONFIG.token) return [];
  const d = await cached("notes.json", 20, async () => {
    const r = new Request(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/notes.json?ref=${CONFIG.branch}`);
    r.timeoutInterval = 15;
    r.headers = { Authorization: "Bearer " + CONFIG.token, Accept: "application/vnd.github.raw+json", "User-Agent": "dabang-widget" };
    const txt = await r.loadString();
    if (r.response.statusCode !== 200) throw new Error("HTTP " + r.response.statusCode);
    return JSON.parse(txt);
  });
  return ((d && d.notes) || []).filter(n => !n.deleted);
}

function pick(topik, notes) {
  const r = Math.random();
  const rand = a => a[Math.floor(Math.random() * a.length)];
  if (notes.length && (r < (LOCK ? 0.3 : 0.5) || !topik)) {
    const n = rand(notes);
    return { lbl: "TỪ ĐÃ GHI", ko: n.ko, vi: n.vi || "", ex: n.ctx || "", exvi: "" };
  }
  if (!topik) return { lbl: "다방", ko: "Chưa có dữ liệu", vi: CONFIG.appUrl ? "Không tải được " + BASE + "topik.json" : "Mở app 다방 → Cài đặt → Sao chép mã widget", ex: "" };
  const k = r < 0.75 ? "vocab" : r < 0.9 ? "grammar" : "idiom";
  // ưu tiên câu nguyên văn đề TOPIK (60%)
  const pool = topik[k];                                   // xoay vòng tất cả, câu ngắn lẫn dài
  const real = pool.filter(y => y.src);
  const x = rand(real.length && Math.random() < 0.6 ? real : pool);
  const lbl = { vocab: "TỪ VỰNG", grammar: "NGỮ PHÁP", idiom: "QUÁN DỤNG NGỮ" }[k];
  return { lbl, ko: x.ko, vi: x.vi + (x.hv ? " · " + x.hv : ""), ex: x.ex || "", exvi: x.exvi || "", src: x.src || "" };
}

const C = { bg: new Color("#f8f2e9"), ink: new Color("#3a2a20"), ink2: new Color("#6f5848"), coffee: new Color("#6e4129"), crema: new Color("#c8955c") };

function build(item, family) {
  const w = new ListWidget();
  if (CONFIG.appUrl) w.url = BASE + "#/vault";
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  if (family === "accessoryInline") {
    w.addText(`${item.ko} · ${item.vi}`);
    return w;
  }
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(item.ko.slice(0, 6));
    t.font = Font.boldSystemFont(12); t.centerAlignText(); t.minimumScaleFactor = 0.5;
    return w;
  }
  if (family === "accessoryRectangular") {
    // 4 dòng nhỏ: cụm · nghĩa / câu ví dụ / bản dịch
    // câu dài → chữ nhỏ hơn + thêm dòng; iOS tự thu nhỏ tiếp (minimumScaleFactor) cho vừa ô
    const long = (item.ex || "").length > 40 || (item.exvi || "").length > 75;
    const k = w.addText(item.ko + (item.vi ? "  ·  " + item.vi : ""));
    k.font = Font.boldSystemFont(long ? 11 : 12); k.lineLimit = 1; k.minimumScaleFactor = 0.6;
    if (item.ex) {
      const e = w.addText(item.ex);
      e.font = Font.systemFont(long ? 9.5 : 11); e.lineLimit = long ? 3 : 2; e.minimumScaleFactor = 0.6;
      if (item.exvi) {
        const ev = w.addText(item.exvi);
        ev.font = Font.italicSystemFont(long ? 8.5 : 10); ev.lineLimit = 2; ev.minimumScaleFactor = 0.6; ev.textOpacity = 0.8;
      }
    } else {
      k.lineLimit = 2;
    }
    return w;
  }
  // màn hình chính
  w.backgroundColor = C.bg;
  w.setPadding(14, 16, 14, 16);
  const big = family === "large", small = family === "small";
  const l = w.addText("☕ " + item.lbl);
  l.font = Font.semiboldSystemFont(10); l.textColor = C.crema;
  w.addSpacer(small ? 6 : 4);
  const k = w.addText(item.ko);
  k.font = new Font("AppleMyungjo", small ? 18 : big ? 24 : 19);
  k.textColor = C.ink; k.minimumScaleFactor = 0.6; k.lineLimit = small ? 2 : 1;
  w.addSpacer(2);
  const v = w.addText(item.vi);
  v.font = Font.systemFont(small ? 12 : 12.5); v.textColor = C.ink2; v.lineLimit = small ? 3 : 1; v.minimumScaleFactor = 0.85;
  if (!small && item.ex) {
    // câu ví dụ (TOPIK II) + bản dịch
    w.addSpacer(big ? 10 : 5);
    const e = w.addText(item.ex);
    e.font = new Font("AppleMyungjo", big ? 15 : 12.5); e.textColor = C.coffee;
    e.lineLimit = big ? 4 : 2; e.minimumScaleFactor = 0.8;
    if (item.exvi) {
      w.addSpacer(2);
      const ev = w.addText(item.exvi);
      ev.font = Font.italicSystemFont(big ? 13 : 11); ev.textColor = C.ink2; ev.textOpacity = 0.8;
      ev.lineLimit = big ? 4 : 2; ev.minimumScaleFactor = 0.8;
    }
    if (item.src) {
      w.addSpacer(2);
      const sr = w.addText("📝 " + item.src);
      sr.font = Font.systemFont(9); sr.textColor = C.crema; sr.lineLimit = 1;
    }
  }
  w.addSpacer();
  return w;
}

const family = config.widgetFamily || "medium";
let widget;
try {
  const [topik, notes] = await Promise.all([loadTopik().catch(() => null), loadNotes().catch(() => [])]);
  widget = build(pick(topik, notes || []), family);
} catch (e) {
  // hiện lỗi thẳng lên widget để biết đường sửa
  widget = new ListWidget();
  const t = widget.addText("다방 ⚠︎ " + String(e && e.message || e).slice(0, 120));
  t.font = Font.systemFont(11); t.minimumScaleFactor = 0.6;
  widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
}
if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
