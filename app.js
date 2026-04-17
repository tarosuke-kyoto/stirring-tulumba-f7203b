‘use strict’;

// ===== 定数 =====
const TAB_COLORS = [’#e03030’,’#e07820’,’#c8c020’,’#50c050’,’#20a0c8’,’#5050e0’,’#9050d0’,’#d050a0’,
‘#b03030’,’#b06020’,’#a0a010’,’#308030’,’#1080a8’,’#3030b0’,’#703090’,’#b03080’];
const ZOOM_STEPS = [1, 2, 4, 8];
const GRID_RADII = [750, 1500, 2250, 3000]; // m

// ===== 状態 =====
let datasets = [];      // [{time, unit, rows:[{alt,dir,spd}]}]
let activeIdx = 0;      // 選択中の時刻インデックス
let isFrom = true;      // From=true, To=false
let zoomIdx = 0;        // ZOOM_STEPSのインデックス
let sortDesc = true;    // 降順=true
let subTab = ‘dst’;     // ‘dst’ | ‘spd’

let settings = {
unit: ‘ms’,
declination: 7,
elevation: 0,
maxSets: 6,
zoomInit: 1
};

// ===== 初期化 =====
function init() {
loadFromStorage();
applySettingsToUI();
render();
}

// ===== localStorage =====
function saveToStorage() {
localStorage.setItem(‘wv_datasets’, JSON.stringify(datasets));
localStorage.setItem(‘wv_settings’, JSON.stringify(settings));
}

function loadFromStorage() {
try {
const d = localStorage.getItem(‘wv_datasets’);
if (d) datasets = JSON.parse(d);
const s = localStorage.getItem(‘wv_settings’);
if (s) settings = { …settings, …JSON.parse(s) };
zoomIdx = ZOOM_STEPS.indexOf(settings.zoomInit);
if (zoomIdx < 0) zoomIdx = 0;
} catch(e) {}
}

// ===== パーサー =====
function parseDataset(text) {
const lines = text.replace(/\r/g, ‘’).split(’\n’).map(l => l.trim());

let time = null;
let unit = ‘kt’;
let rows = [];
let i = 0;

// time: ブロックを探す
while (i < lines.length) {
if (lines[i].toLowerCase() === ‘time:’) {
i++;
if (i < lines.length && lines[i]) {
time = lines[i].trim();
}
i++;
break;
}
i++;
}

// Altitude / degree / unit 行をスキップ
while (i < lines.length) {
const l = lines[i].toLowerCase();
if (l === ‘altitude’ || l === ‘degree’) { i++; continue; }
if (l === ‘kt’ || l === ‘m/s’ || l === ‘ms’ || l === ‘km/h’ || l === ‘kmh’) {
unit = l === ‘ms’ ? ‘m/s’ : l;
i++; break;
}
// 高度行が来たら抜ける
if (/\d/.test(lines[i])) break;
i++;
}

// データ行を読む
while (i < lines.length) {
const altLine = lines[i];
// 高度範囲行の判定: “数字” または “数字-数字m” または “数字- 数字m”
if (!/m$/i.test(altLine) && !/^\d/.test(altLine)) { i++; continue; }

```
let alt = null;
if (/m$/i.test(altLine)) {
  // "0-100m" or "900- 1000m" or "1000m"
  const nums = altLine.match(/\d+/g);
  if (nums && nums.length >= 2) {
    alt = (parseFloat(nums[0]) + parseFloat(nums[1])) / 2;
  } else if (nums && nums.length === 1) {
    alt = parseFloat(nums[0]);
  }
}

if (alt === null) { i++; continue; }

const dirLine = lines[i + 1];
const spdLine = lines[i + 2];

const dir = parseFloat(dirLine);
const spd = parseFloat(spdLine);

if (isNaN(dir) || isNaN(spd)) { i++; continue; }

rows.push({ alt, dir, spd });
i += 3;
```

}

if (rows.length === 0) return null;

// 内部単位はm/sに統一
rows = rows.map(r => ({
alt: r.alt,
dir: r.dir,
spd: toMs(r.spd, unit)
}));

return {
time: time || ‘??:??’,
unit,
rows: rows.sort((a, b) => a.alt - b.alt)
};
}

function toMs(spd, unit) {
if (unit === ‘kt’) return spd * 0.5144;
if (unit === ‘km/h’ || unit === ‘kmh’) return spd / 3.6;
return spd;
}

function fromMs(spd, unit) {
if (unit === ‘kt’) return spd / 0.5144;
if (unit === ‘km/h’ || unit === ‘kmh’) return spd * 3.6;
return spd;
}

// ===== 距離チャート用: ベクトル積算 =====
// 各100m層を上昇するのに1分(60秒)かかる → 水平移動距離 = spd[m/s] × 60
function computeTrack(rows) {
// rows は alt昇順
// 気象風向: 0°=北から吹く, 90°=東から吹く
// 風が「吹いていく」方向(To) = 風向 + 180°
// 座標系: x=東正, y=北正
const track = [{ x: 0, y: 0, alt: rows[0] ? rows[0].alt : 0 }];
let cx = 0, cy = 0;

for (const r of rows) {
const dist = r.spd * 60; // 1分間の水平移動距離[m]
// 風が向かう方向(To方向)
const toDir = (r.dir + 180) % 360;
const toRad = toDir * Math.PI / 180;
// 数学座標: x=East, y=North
// 0°=北=y+, 90°=東=x+
cx += Math.sin(toRad) * dist;
cy += Math.cos(toRad) * dist;
track.push({ x: cx, y: cy, alt: r.alt });
}
return track;
}

// ===== 描画 =====
function drawHodograph() {
const canvas = document.getElementById(‘hodCanvas’);
const ctx = canvas.getContext(‘2d’);
const size = canvas.offsetWidth;
canvas.width = size * (window.devicePixelRatio || 1);
canvas.height = size * (window.devicePixelRatio || 1);
ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

ctx.clearRect(0, 0, size, size);

const cx = size / 2;
const cy = size / 2;
const zoom = ZOOM_STEPS[zoomIdx];
// 3000m が size*0.45 に収まるようにスケール
const baseScale = (size * 0.45) / 3000;
const scale = baseScale * zoom;

// –– グリッド ––
ctx.save();

// 十字線
ctx.strokeStyle = ‘#dde1e9’;
ctx.lineWidth = 1;
ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, size); ctx.stroke();
ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(size, cy); ctx.stroke();

// 斜め45°
ctx.strokeStyle = ‘#eaecf0’;
ctx.setLineDash([3, 5]);
const diag = size * 0.8;
ctx.beginPath(); ctx.moveTo(cx - diag, cy - diag); ctx.lineTo(cx + diag, cy + diag); ctx.stroke();
ctx.beginPath(); ctx.moveTo(cx + diag, cy - diag); ctx.lineTo(cx - diag, cy + diag); ctx.stroke();
ctx.setLineDash([]);

// 同心円
for (const r of GRID_RADII) {
const pr = r * scale;
ctx.beginPath();
ctx.arc(cx, cy, pr, 0, Math.PI * 2);
ctx.strokeStyle = ‘#cdd2de’;
ctx.lineWidth = 1;
ctx.stroke();

```
// ラベル（下方向）
ctx.fillStyle = '#8a94a8';
ctx.font = `500 11px 'DM Mono', monospace`;
ctx.textAlign = 'center';
ctx.fillText(`${r} [m]`, cx + 10, cy + pr - 4);
```

}

// 方位ラベル
ctx.fillStyle = ‘#8a94a8’;
ctx.font = `600 12px 'Outfit', sans-serif`;
ctx.textAlign = ‘center’;
ctx.fillText(‘N’, cx, 16);
ctx.fillText(‘S’, cx, size - 6);
ctx.textAlign = ‘left’;
ctx.fillText(‘E’, size - 14, cy + 5);
ctx.textAlign = ‘right’;
ctx.fillText(‘W’, 14, cy + 5);
ctx.restore();

if (datasets.length === 0) return;

// –– データ描画（古い順に描いて最新を上に）––
const maxSets = settings.maxSets;
// activeIdx が最新(赤)。表示する時刻セットを選ぶ
// datasets はインデックス0が最初に追加されたもの
// 「最新 = 最後に追加されたもの = 末尾」の想定
const endIdx = datasets.length - 1;
const startIdx = Math.max(0, endIdx - maxSets + 1);
const visibleSets = datasets.slice(startIdx, endIdx + 1).reverse(); // [最新, …古い]

for (let si = visibleSets.length - 1; si >= 0; si–) {
const ds = visibleSets[si];
const colorIdx = si; // 0=最新=赤
const color = TAB_COLORS[colorIdx] || TAB_COLORS[TAB_COLORS.length - 1];

```
const track = computeTrack(ds.rows);

// 軌跡をcanvas座標に変換
// x=East正, y=North正 → canvas: sx=cx+x*scale, sy=cy-y*scale（北が上）
const toCanvas = (p) => {
  // From: 中心から「風が来る方向」へ伸びる → Toの逆向き = -x, -y
  const vx = isFrom ? -p.x : p.x;
  const vy = isFrom ? -p.y : p.y;
  return {
    sx: cx + vx * scale,
    sy: cy - vy * scale
  };
};

// 線
ctx.beginPath();
ctx.strokeStyle = color;
ctx.lineWidth = si === 0 ? 2.5 : 1.8;
ctx.globalAlpha = si === 0 ? 1.0 : 0.65;
for (let i = 0; i < track.length; i++) {
  const { sx, sy } = toCanvas(track[i]);
  if (i === 0) ctx.moveTo(sx, sy);
  else ctx.lineTo(sx, sy);
}
ctx.stroke();

// 点
for (let i = 1; i < track.length; i++) {
  const { sx, sy } = toCanvas(track[i]);
  ctx.beginPath();
  ctx.arc(sx, sy, si === 0 ? 4 : 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

ctx.globalAlpha = 1.0;
```

}
}

// ===== テーブル =====
function renderTable() {
const container = document.getElementById(‘tableScroll’);
if (datasets.length === 0) {
container.innerHTML = ‘’;
return;
}

const maxSets = settings.maxSets;
const endIdx = datasets.length - 1;
const startIdx = Math.max(0, endIdx - maxSets + 1);
const visibleSets = datasets.slice(startIdx, endIdx + 1);

// 全高度レイヤーを収集
const allAlts = new Set();
visibleSets.forEach(ds => ds.rows.forEach(r => allAlts.add(r.alt)));
let alts = Array.from(allAlts).sort((a, b) => a - b);
if (sortDesc) alts = alts.reverse();

const dispUnit = settings.unit;
const elev = settings.elevation;
const decl = settings.declination;

// ヘッダー行1: セット時刻
let html = ‘<table class="wind-table">’;
html += ‘<thead>’;
// 1行目: 固定列ヘッダー + 時刻ヘッダー（各セット3列）
html += ‘<tr>’;
html += ‘<th rowspan="2">AGL<br>[m]</th>’;
html += ‘<th rowspan="2">MSL<br>[ft]</th>’;

visibleSets.forEach((ds, si) => {
const colorIdx = (endIdx - startIdx) - si; // 最新=0=赤
const color = TAB_COLORS[colorIdx] || TAB_COLORS[TAB_COLORS.length - 1];
html += `<th colspan="3" class="set-header" style="background:${color}">${ds.time}</th>`;
});
html += ‘</tr>’;

// 2行目: 各セットの列名
html += ‘<tr>’;
visibleSets.forEach(() => {
const unitLabel = dispUnit === ‘ms’ ? ‘m/s’ : dispUnit === ‘kt’ ? ‘kt’ : ‘km/h’;
html += `<th>To<br>(Mag)</th><th>Spd<br>[${unitLabel}]</th><th>Spd<br>[km/h]</th>`;
});
html += ‘</tr>’;
html += ‘</thead><tbody>’;

// データ行
alts.forEach(alt => {
const msl = Math.round((alt + elev) * 3.28084); // m → ft
html += ‘<tr>’;
html += `<td class="alt-cell">${alt}</td>`;
html += `<td class="msl-cell">${msl}</td>`;

```
visibleSets.forEach(ds => {
  const row = ds.rows.find(r => r.alt === alt);
  if (row) {
    const magDir = Math.round((row.dir + decl + 360) % 360);
    const toDir = Math.round((magDir + 180) % 360);
    const spdDisp = dispUnit === 'ms' ? row.spd.toFixed(1)
                  : dispUnit === 'kt' ? (row.spd / 0.5144).toFixed(1)
                  : (row.spd * 3.6).toFixed(1);
    const spdKmh = (row.spd * 3.6).toFixed(1);
    html += `<td>${toDir}</td><td>${spdDisp}</td><td>${spdKmh}</td>`;
  } else {
    html += '<td>-</td><td>-</td><td>-</td>';
  }
});
html += '</tr>';
```

});

html += ‘</tbody></table>’;
html += `<button class="table-sort-btn" onclick="toggleSort()">${sortDesc ? '↑ 昇順で表示' : '↓ 降順で表示'}</button>`;

container.innerHTML = html;
}

// ===== タブUI =====
function renderTabs() {
const container = document.getElementById(‘timeTabs’);
container.innerHTML = ‘’;

datasets.forEach((ds, i) => {
const colorIdx = (datasets.length - 1) - i; // 最後=0=赤
const color = TAB_COLORS[colorIdx] || TAB_COLORS[TAB_COLORS.length - 1];

```
const tab = document.createElement('div');
tab.className = 'time-tab' + (i === activeIdx ? ' active' : '');
tab.style.setProperty('--tab-color', color);
tab.innerHTML = `${ds.time}<button class="del-btn" onclick="deleteDataset(event,${i})">✕</button>`;
tab.addEventListener('click', () => { activeIdx = i; render(); });
container.appendChild(tab);
```

});

// ヘッダー日付
if (datasets.length > 0) {
document.getElementById(‘headerDate’).textContent = ‘測定データ’;
document.getElementById(‘updateTime’).textContent = `更新 ${datasets[datasets.length - 1].time}`;
}
}

// ===== モーダル =====
function openAddModal() {
document.getElementById(‘addModal’).classList.add(‘open’);
document.getElementById(‘pasteArea’).value = ‘’;
document.getElementById(‘pasteArea’).focus();
}

function closeAddModal(e) {
if (e && e.target !== document.getElementById(‘addModal’)) return;
document.getElementById(‘addModal’).classList.remove(‘open’);
}

function addDataset() {
const text = document.getElementById(‘pasteArea’).value;
if (!text.trim()) { alert(‘データを貼り付けてください’); return; }

const ds = parseDataset(text);
if (!ds) { alert(‘データを読み取れませんでした。\n形式を確認してください。’); return; }

datasets.push(ds);
activeIdx = datasets.length - 1;
saveToStorage();
document.getElementById(‘addModal’).classList.remove(‘open’);
render();
}

function deleteDataset(e, i) {
e.stopPropagation();
if (!confirm(`${datasets[i].time} を削除しますか？`)) return;
datasets.splice(i, 1);
activeIdx = Math.min(activeIdx, Math.max(0, datasets.length - 1));
saveToStorage();
render();
}

// 設定
function openMenu() { document.getElementById(‘menuModal’).classList.add(‘open’); }
function closeMenu(e) {
if (e && e.target !== document.getElementById(‘menuModal’)) return;
document.getElementById(‘menuModal’).classList.remove(‘open’);
}

function openSettings() {
document.getElementById(‘menuModal’).classList.remove(‘open’);
applySettingsToUI();
document.getElementById(‘settingsModal’).classList.add(‘open’);
}

function closeSettings(e) {
if (e && e.target !== document.getElementById(‘settingsModal’)) return;
document.getElementById(‘settingsModal’).classList.remove(‘open’);
}

function applySettingsToUI() {
document.getElementById(‘setUnit’).value = settings.unit;
document.getElementById(‘setDeclination’).value = settings.declination;
document.getElementById(‘setElevation’).value = settings.elevation;
document.getElementById(‘setMaxSets’).value = settings.maxSets;
document.getElementById(‘setZoom’).value = settings.zoomInit;
}

function saveSettings() {
settings.unit = document.getElementById(‘setUnit’).value;
settings.declination = parseFloat(document.getElementById(‘setDeclination’).value) || 0;
settings.elevation = parseFloat(document.getElementById(‘setElevation’).value) || 0;
settings.maxSets = parseInt(document.getElementById(‘setMaxSets’).value) || 6;
settings.zoomInit = parseInt(document.getElementById(‘setZoom’).value) || 1;
saveToStorage();
document.getElementById(‘settingsModal’).classList.remove(‘open’);
render();
}

function clearAll() {
if (!confirm(‘全データを削除しますか？’)) return;
datasets = [];
activeIdx = 0;
saveToStorage();
document.getElementById(‘menuModal’).classList.remove(‘open’);
render();
}

// From/To
function toggleFromTo() {
isFrom = !isFrom;
document.getElementById(‘fromtoBtn’).textContent = isFrom ? ‘From’ : ‘To’;
drawHodograph();
}

// ズーム
function zoomIn() {
zoomIdx = (zoomIdx + 1) % ZOOM_STEPS.length;
const z = ZOOM_STEPS[zoomIdx];
document.getElementById(‘zoomLabel’).textContent = `×${z}.0`;
drawHodograph();
}

// ソート
function toggleSort() {
sortDesc = !sortDesc;
renderTable();
}

// サブタブ
function switchSubTab(tab) {
subTab = tab;
document.getElementById(‘tabDst’).classList.toggle(‘active’, tab === ‘dst’);
document.getElementById(‘tabSpd’).classList.toggle(‘active’, tab === ‘spd’);
drawHodograph();
}

// ===== 空状態 =====
function renderEmpty() {
const canvas = document.getElementById(‘hodCanvas’);
const ctx = canvas.getContext(‘2d’);
const size = canvas.offsetWidth;
canvas.width = size * (window.devicePixelRatio || 1);
canvas.height = size * (window.devicePixelRatio || 1);
ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
ctx.clearRect(0, 0, size, size);

const cx = size / 2, cy = size / 2;
const scale = (size * 0.45) / 3000;

ctx.strokeStyle = ‘#dde1e9’; ctx.lineWidth = 1;
ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, size); ctx.stroke();
ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(size, cy); ctx.stroke();
for (const r of GRID_RADII) {
ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
ctx.strokeStyle = ‘#cdd2de’; ctx.stroke();
ctx.fillStyle = ‘#b0b8cc’;
ctx.font = `500 11px 'DM Mono', monospace`;
ctx.textAlign = ‘center’;
ctx.fillText(`${r} [m]`, cx + 10, cy + r * scale - 4);
}

ctx.fillStyle = ‘#c8d0e0’;
ctx.font = `700 14px 'Outfit', sans-serif`;
ctx.textAlign = ‘center’;
ctx.fillText(‘データを追加してください’, cx, cy - 20);
ctx.font = `400 12px 'Outfit', sans-serif`;
ctx.fillText(‘＋ ボタンからペーストで追加’, cx, cy + 4);
}

// ===== メインレンダー =====
function render() {
renderTabs();
if (datasets.length === 0) {
renderEmpty();
document.getElementById(‘tableScroll’).innerHTML =
`<div class="empty-state"> <div class="icon">🌬️</div> <p>風データがありません<br>＋ ボタンでデータを追加してください</p> <button class="empty-cta" onclick="openAddModal()">データを追加</button> </div>`;
return;
}
drawHodograph();
renderTable();
}

// ===== リサイズ対応 =====
window.addEventListener(‘resize’, () => {
if (datasets.length === 0) renderEmpty();
else drawHodograph();
});

// ===== 起動 =====
window.addEventListener(‘DOMContentLoaded’, init);