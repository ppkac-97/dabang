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

const fm = FileManager.local();
const dir = fm.joinPath(fm.documentsDirectory(), "dabang");
if (!fm.fileExists(dir)) fm.createDirectory(dir);
const P = n => fm.joinPath(dir, n);

async function cached(name, maxAgeMin, fetcher) {
  const f = P(name);
  const fresh = fm.fileExists(f) && (Date.now() - fm.modificationDate(f).getTime()) / 60000 < maxAgeMin;
  if (fresh) return JSON.parse(fm.readString(f));
  try {
    const data = await fetcher();
    fm.writeString(f, JSON.stringify(data));
    return data;
  } catch (e) {
    return fm.fileExists(f) ? JSON.parse(fm.readString(f)) : null;
  }
}

async function loadTopik() {
  if (!CONFIG.appUrl) return null;
  return cached("topik-v3.json", 24 * 60, async () => {
    const r = new Request(CONFIG.appUrl.replace(/\/?$/, "/") + "topik.json");
    return await r.loadJSON();
  });
}
async function loadNotes() {
  if (!CONFIG.owner || !CONFIG.token) return [];
  const d = await cached("notes.json", 20, async () => {
    const r = new Request(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/notes.json?ref=${CONFIG.branch}`);
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
  if (notes.length && (r < 0.5 || !topik)) {
    const n = rand(notes);
    return { lbl: "TỪ ĐÃ GHI", ko: n.ko, vi: n.vi || "", ex: n.ctx || "", exvi: "" };
  }
  if (!topik) return { lbl: "다방", ko: "Chưa có dữ liệu", vi: "Mở app 다방 → Cài đặt → Sao chép mã widget", ex: "" };
  const k = r < 0.75 ? "vocab" : r < 0.9 ? "grammar" : "idiom";
  const real = topik[k].filter(y => y.src);              // ưu tiên câu nguyên văn trong đề TOPIK
  const x = rand(real.length && Math.random() < 0.6 ? real : topik[k]);
  const lbl = { vocab: "TỪ VỰNG", grammar: "NGỮ PHÁP", idiom: "QUÁN DỤNG NGỮ" }[k];
  return { lbl, ko: x.ko, vi: x.vi + (x.hv ? " · " + x.hv : ""), ex: x.ex || "", exvi: x.exvi || "", src: x.src || "" };
}

const C = { bg: new Color("#f8f2e9"), ink: new Color("#3a2a20"), ink2: new Color("#6f5848"), coffee: new Color("#6e4129"), crema: new Color("#c8955c") };

function build(item, family) {
  const w = new ListWidget();
  if (CONFIG.appUrl) w.url = CONFIG.appUrl.replace(/\/?$/, "/") + "#/vault";
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
    const k = w.addText(item.ko);
    k.font = Font.boldSystemFont(15); k.lineLimit = 1; k.minimumScaleFactor = 0.6;
    const v = w.addText(item.vi);
    v.font = Font.systemFont(12); v.lineLimit = 2; v.minimumScaleFactor = 0.8; v.textOpacity = 0.85;
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

const [topik, notes] = await Promise.all([loadTopik(), loadNotes()]);
const item = pick(topik, notes);
const family = config.widgetFamily || "medium";
const widget = build(item, family);
if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
