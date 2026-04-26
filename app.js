// 日本の一次エネルギー総供給量: 約17.5 EJ/年（資源エネルギー庁 エネルギー白書2023）
const JAPAN_ANNUAL_EJ = 17.5e18; // J/year
const JAPAN_DAILY_J = JAPAN_ANNUAL_EJ / 365; // ≈ 4.79e16 J/day = 47.9 PJ/day

function magToJoules(m) {
  return Math.pow(10, 1.5 * m + 4.8);
}

function formatEnergy(j) {
  if (j >= 1e15) return (j / 1e15).toFixed(2) + " PJ";
  if (j >= 1e12) return (j / 1e12).toFixed(2) + " TJ";
  if (j >= 1e9) return (j / 1e9).toFixed(2) + " GJ";
  if (j >= 1e6) return (j / 1e6).toFixed(2) + " MJ";
  if (j >= 1e3) return (j / 1e3).toFixed(2) + " kJ";
  return j.toFixed(0) + " J";
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function magClass(m) {
  if (m >= 5.0) return "mag-high";
  if (m >= 3.0) return "mag-mid";
  return "mag-low";
}

/* --------------------------------------------------------------------------
   Seismograph rendering — warm crimson trace on cream surface
   X 軸 = 過去24時間 (左端が 24h 前、右端が現在)
   -------------------------------------------------------------------------- */
const canvas = document.getElementById("seismo");
const ctx = canvas.getContext("2d");
let waveData = [];
let lastQuakes = [];
let timeWindow = null; // { sinceMs, nowMs }

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}
resizeCanvas();
window.addEventListener("resize", () => {
  resizeCanvas();
  if (lastQuakes.length) waveData = generateWave(lastQuakes);
});

// 決定論的擬似乱数 — リサイズしても波形が安定するように
function pseudo(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function drawSeismo() {
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  ctx.clearRect(0, 0, W, H);

  // 6時間ごとの薄い目盛り線
  ctx.strokeStyle = "rgba(38, 37, 30, 0.07)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const x = (i / 4) * W;
    ctx.beginPath();
    ctx.moveTo(x, 4);
    ctx.lineTo(x, H - 4);
    ctx.stroke();
  }

  // 中央のベースライン
  ctx.strokeStyle = "rgba(38, 37, 30, 0.14)";
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  if (waveData.length < 2) {
    requestAnimationFrame(drawSeismo);
    return;
  }

  // 波形 — 暖色クリムゾン
  ctx.strokeStyle = "#cf2d56";
  ctx.lineWidth = 1.4;
  ctx.shadowColor = "rgba(207, 45, 86, 0.35)";
  ctx.shadowBlur = 4;
  ctx.beginPath();
  waveData.forEach((y, i) => {
    const x = (i / (waveData.length - 1)) * W;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  requestAnimationFrame(drawSeismo);
}
drawSeismo();

function generateWave(quakes) {
  const H = canvas.offsetHeight || 72;
  const pts = 480;
  const baseY = H / 2;

  // 静かな決定論ノイズ
  const base = Array.from({ length: pts }, (_, i) => {
    return baseY + Math.sin(i * 0.18) * 0.6 + (pseudo(i) - 0.5) * 1.2;
  });

  if (!timeWindow) return base;
  const { sinceMs, nowMs } = timeWindow;
  const span = nowMs - sinceMs;
  if (span <= 0) return base;

  quakes.forEach((q, qi) => {
    const mag = q.properties.mag || 1;
    const t = q.properties.time;
    if (t == null) return;

    // 実発生時刻 → X 位置
    const ratio = (t - sinceMs) / span;
    if (ratio < 0 || ratio > 1) return;
    const pos = Math.round(ratio * (pts - 1));

    // マグニチュードに比例した振幅 (M7 でほぼ天井)
    const spike = Math.min((mag / 7) * (H / 2 - 4), H / 2 - 4);
    const sign = qi % 2 === 0 ? 1 : -1;

    for (let k = -10; k <= 10; k++) {
      const idx = pos + k;
      if (idx >= 0 && idx < pts) {
        const envelope = Math.exp((-k * k) / 10);
        base[idx] += sign * spike * envelope;
      }
    }
  });
  return base;
}

/* --------------------------------------------------------------------------
   Data fetch & render
   -------------------------------------------------------------------------- */
async function fetchQuakes() {
  const now = new Date();
  const since = new Date(now - 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString();

  // Japan bounding box
  const target =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&starttime=${fmt(since)}&endtime=${fmt(now)}` +
    `&minlatitude=24&maxlatitude=46` +
    `&minlongitude=122&maxlongitude=146` +
    `&minmagnitude=1.0` +
    `&orderby=magnitude`;

  // file:// 起動時の CORS 回避
  const proxy = `https://corsproxy.io/?url=`;
  const url = proxy + encodeURIComponent(target);

  try {
    const res = await fetch(url);
    const data = await res.json();
    const quakes = data.features || [];

    lastQuakes = quakes;
    timeWindow = { sinceMs: since.getTime(), nowMs: now.getTime() };
    waveData = generateWave(quakes);

    // 時刻軸ラベルを実時刻で更新
    const axisEl = document.getElementById("seismo-axis");
    if (axisEl) {
      const fmtHM = (d) =>
        d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      const ts = [0, 0.25, 0.5, 0.75, 1].map(
        (r) => new Date(since.getTime() + r * (now - since)),
      );
      axisEl.innerHTML = `
        <span>${fmtHM(ts[0])}<small>−24h</small></span>
        <span>${fmtHM(ts[1])}<small>−18h</small></span>
        <span>${fmtHM(ts[2])}<small>−12h</small></span>
        <span>${fmtHM(ts[3])}<small>−6h</small></span>
        <span>${fmtHM(ts[4])}<small>now</small></span>
      `;
    }

    // const totalJ = 1e17;
    const totalJ = quakes.reduce(
      (sum, q) => sum + magToJoules(q.properties.mag || 0),
      0,
    );
    const maxMag = quakes.length
      ? Math.max(...quakes.map((q) => q.properties.mag || 0))
      : 0;

    // Stats
    document.getElementById("count").textContent = quakes.length;
    const [valStr, unitStr] = formatEnergy(totalJ).split(" ");
    document.getElementById("total-j").textContent = valStr;
    document.getElementById("total-unit").textContent = unitStr;
    document.getElementById("max-mag").textContent = maxMag.toFixed(1);

    // Comparison bars
    const ratio = totalJ / JAPAN_DAILY_J;
    const maxBar = Math.max(totalJ, JAPAN_DAILY_J);
    const quakePct = Math.min((totalJ / maxBar) * 100, 100);
    const humanPct = Math.min((JAPAN_DAILY_J / maxBar) * 100, 100);

    document.getElementById("bar-quake-val").textContent = formatEnergy(totalJ);

    setTimeout(() => {
      document.getElementById("bar-quake").style.width = quakePct + "%";
      document.getElementById("bar-human").style.width = humanPct + "%";
    }, 300);

    const ratioEl = document.getElementById("ratio-text");
    const pct = (ratio * 100).toFixed(5);
    console.log(pct);

    if (ratio >= 1) {
      ratioEl.innerHTML = `24時間の地震エネルギーは、日本の1日エネルギー消費量の
        <span class="big-num">${pct} 倍</span>
        地震活動が非常に活発な日でした`;
    } else if (ratio >= 0.01) {
      ratioEl.innerHTML = `24時間の地震エネルギーは、日本の1日エネルギー消費量の
        <span class="big-num">${pct}%</span>
        日本全体の消費量（約 47.9 PJ）と比べると ${(1 / ratio).toFixed(0)} 分の1のエネルギー`;
    } else {
      ratioEl.innerHTML = `24時間の地震エネルギーは、日本の1日エネルギー消費量の
        <span class="big-num">${pct}%</span>
        地震が少ない・小さい日。日本の消費量と比べると微小なエネルギー`;
    }

    // List
    const listEl = document.getElementById("quake-list");
    if (quakes.length === 0) {
      listEl.innerHTML =
        '<div class="status-msg">該当する地震データがありませんでした</div>';
      return;
    }

    listEl.innerHTML = quakes
      .slice(0, 50)
      .map((q) => {
        const mag = q.properties.mag || 0;
        const energy = magToJoules(mag);
        const place = (q.properties.place || "不明")
          .replace(/\d+ km .* of /, "")
          .replace("Japan", "")
          .trim();
        return `<div class="quake-row">
        <span class="quake-place" title="${q.properties.place}">${place || q.properties.place}</span>
        <span><span class="mag-badge ${magClass(mag)}">M ${mag.toFixed(1)}</span></span>
        <span class="quake-energy">${formatEnergy(energy)}</span>
        <span class="quake-time">${formatTime(q.properties.time)}</span>
      </div>`;
      })
      .join("");

    document.getElementById("update-time").textContent =
      `最終更新: ${now.toLocaleString("ja-JP")} | データ: USGS Earthquake Hazards Program`;
  } catch (e) {
    document.getElementById("quake-list").innerHTML =
      `<div class="status-msg">データ取得に失敗しました。ネットワークを確認してください。<br><small>${e.message}</small></div>`;
  }
}

fetchQuakes();
