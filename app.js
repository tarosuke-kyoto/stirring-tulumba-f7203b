let currentData = [];

// ボタン
document.getElementById("normalizeBtn").addEventListener("click", normalize);
document.getElementById("applyBtn").addEventListener("click", apply);

// ===== 整形 =====
function normalize() {

  const text = document.getElementById("raw").value;

  if (!text) {
    alert("入力が空");
    return;
  }

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l);

  let result = [];

  for (let i = 0; i < lines.length; i++) {

    // 「mで終わる行」だけ対象
    if (/m$/.test(lines[i])) {

      let altLine = lines[i];

      let dir = parseFloat(lines[i + 1]);
      let spd = parseFloat(lines[i + 2]);

      if (isNaN(dir) || isNaN(spd)) continue;

      let alt;

      // 0-100m 形式
      if (altLine.includes("-")) {
        const nums = altLine.match(/\d+/g);
        if (nums && nums.length === 2) {
          alt = (parseFloat(nums[0]) + parseFloat(nums[1])) / 2;
        } else {
          continue;
        }
      } 
      // - 1000m 形式
      else {
        const num = altLine.match(/\d+/);
        if (!num) continue;
        alt = parseFloat(num[0]);
      }

      result.push({ alt, dir, spd });
    }
  }

  if (result.length === 0) {
    alert("読み取れない（改行 or 形式確認）");
    return;
  }

  currentData = result;
  renderTable();
}

// ===== テーブル表示 =====
function renderTable() {

  let html = "<table><tr><th>高度</th><th>風向</th><th>風速</th></tr>";

  currentData.forEach((d, i) => {
    html += `
<tr>
<td><input value="${d.alt}" onchange="edit(${i}, 'alt', this.value)"></td>
<td><input value="${d.dir}" onchange="edit(${i}, 'dir', this.value)"></td>
<td><input value="${d.spd}" onchange="edit(${i}, 'spd', this.value)"></td>
</tr>`;
  });

  html += "</table>";

  document.getElementById("table").innerHTML = html;
}

// ===== 編集反映 =====
function edit(i, key, val) {
  currentData[i][key] = parseFloat(val);
}

// ===== グラフ描画 =====
function apply() {
  draw(currentData);
}

// ===== 色 =====
function getColor(s) {
  if (s < 5) return "#00aaff";
  if (s < 10) return "#00ff88";
  if (s < 15) return "#ffee00";
  if (s < 20) return "#ff8800";
  return "#ff0000";
}

// ===== 描画 =====
function draw(data) {

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientWidth;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const scale = 6;

  // グリッド
  for (let r = 40; r <= 200; r += 40) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#333";
    ctx.stroke();
  }

  // 方位
  ctx.fillStyle = "#777";
  ctx.font = "12px Arial";
  ctx.fillText("N", cx - 5, 12);
  ctx.fillText("E", canvas.width - 15, cy);
  ctx.fillText("S", cx - 5, canvas.height - 5);
  ctx.fillText("W", 5, cy);

  // 高度順
  data.sort((a, b) => a.alt - b.alt);

  for (let i = 0; i < data.length; i++) {

    const d = data[i];

    const angle = (d.dir + 180) * Math.PI / 180;
    const r = d.spd * scale;

    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    const color = getColor(d.spd);

    // 線
    if (i > 0) {
      const p = data[i - 1];
      const a2 = (p.dir + 180) * Math.PI / 180;
      const r2 = p.spd * scale;

      const x2 = cx + Math.cos(a2) * r2;
      const y2 = cy + Math.sin(a2) * r2;

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 点
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}