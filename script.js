// Simple spin-the-wheel for itch.io links
// Data model: items = [{title, url, hidden:false}]
const inputArea = document.getElementById("inputArea");
const clearBtn = document.getElementById("clearBtn");
const pasteBtn = document.getElementById("pasteBtn");
const loadBtn = document.getElementById("loadBtn");
const copyBtn = document.getElementById("copyBtn");
const itemsUl = document.getElementById("items");
const wheelCanvas = document.getElementById("wheel");
const spinBtn = document.getElementById("spinBtn");
const resultDiv = document.getElementById("result");
const ctx = wheelCanvas.getContext("2d");

let items = [];
let isSpinning = false;
let rotation = 0; // degrees
let angularVelocity = 0;
let spinAnimationFrame = null;
let winnerAnimation = {
  isAnimating: false,
  winnerIndex: -1,
  scale: 1.0,
  startTime: 0,
};

// Utilities
function formatTitle(title) {
  // Remove dashes and underscores, replace with spaces
  let formatted = title.replace(/[-_]/g, " ");

  // Split into words and capitalize appropriately
  const words = formatted.split(" ").filter((word) => word.length > 0);
  const lowercaseWords = [
    "of",
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "a",
    "an",
  ];

  const capitalizedWords = words.map((word, index) => {
    // Always capitalize first and last word
    if (index === 0 || index === words.length - 1) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    // Check if it's a lowercase word
    if (lowercaseWords.includes(word.toLowerCase())) {
      return word.toLowerCase();
    }
    // Capitalize other words
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return capitalizedWords.join(" ");
}

function parseLines(text) {
  // Remove surrounding Discord ``code`` if present
  if (typeof text === "string") {
    text = text.trim();
    // Triple backticks with optional language tag, e.g. ``` or ```txt
    const tripleFenceMatch = text.match(/^```([^\n]*)\n([\s\S]*)\n```$/);
    if (tripleFenceMatch) {
      text = tripleFenceMatch[2].trim();
    } else if (text.startsWith("``") && text.endsWith("``")) {
      text = text.slice(2, -2).trim();
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed = lines.map((l) => {
    const parts = l.split("\t");
    if (parts.length >= 2) {
      return {
        title: formatTitle(parts[0].trim()),
        url: parts[1].trim(),
        hidden: false,
      };
    }
    // if only URL or single column, try to infer title
    try {
      const u = new URL(l);
      const rawTitle = decodeURIComponent(
        u.pathname.split("/").filter(Boolean).pop() || u.hostname
      );
      return { title: formatTitle(rawTitle), url: l, hidden: false };
    } catch (e) {
      return { title: formatTitle(l), url: l, hidden: false };
    }
  });
  return parsed;
}

function saveToStorage() {
  localStorage.setItem("wheel_items", JSON.stringify(items));
}
function loadFromStorage() {
  const raw = localStorage.getItem("wheel_items");
  if (!raw) return false;
  try {
    items = JSON.parse(raw);
    return true;
  } catch (e) {
    return false;
  }
}
function saveHidden() {
  const hidden = items.map((it) => !!it.hidden);
  localStorage.setItem("wheel_hidden", JSON.stringify(hidden));
}
function loadHidden() {
  const raw = localStorage.getItem("wheel_hidden");
  if (!raw) return false;
  try {
    const arr = JSON.parse(raw);
    arr.forEach((h, i) => {
      if (items[i]) items[i].hidden = !!h;
    });
    return true;
  } catch (e) {
    return false;
  }
}

// Rendering
function rebuildList() {
  itemsUl.innerHTML = "";
  items.forEach((it, idx) => {
    const li = document.createElement("li");
    if (it.hidden) li.classList.add("hidden");
    const a = document.createElement("a");
    a.href = it.url;
    a.textContent = it.title;
    a.target = "_blank";
    a.className = "item-title";
    li.appendChild(a);
    const actions = document.createElement("div");
    actions.className = "item-actions";
    const hideBtn = document.createElement("button");
    hideBtn.textContent = it.hidden ? "Unhide" : "Hide";
    hideBtn.className = "toggle-hidden";
    hideBtn.addEventListener("click", () => {
      it.hidden = !it.hidden;

      // If item was hidden, remove corresponding lines from the textarea
      if (it.hidden) {
        try {
          const rawLines = (inputArea.value || "").split(/\r?\n/);
          const kept = rawLines.filter((line) => {
            const l = line.trim();
            if (!l) return false; // drop empty lines
            // If the line is tab-separated like "title\turl", check the url part
            const parts = l.split("\t");
            if (it.url && parts.length >= 2) {
              return parts[1].trim() !== it.url;
            }
            // If the line contains the url anywhere, drop it
            if (it.url && l.includes(it.url)) return false;
            // Fall back to checking title inclusion (less strict)
            if (it.title && (l === it.title || l.includes(it.title)))
              return false;
            return true;
          });
          inputArea.value = kept.join("\n");
        } catch (e) {
          // ignore any errors here
        }
      } else {
        // If item was unhidden, append it back to the textarea (avoid duplicates)
        try {
          const rawLines = (inputArea.value || "")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          const exists = rawLines.some((line) => {
            if (!line) return false;
            if (it.url && line.includes(it.url)) return true;
            if (it.title && (line === it.title || line.includes(it.title)))
              return true;
            return false;
          });
          if (!exists) {
            const toAdd =
              it.title && it.url
                ? `${it.title}\t${it.url}`
                : it.url || it.title || "";
            if (toAdd) {
              rawLines.push(toAdd);
              inputArea.value = rawLines.join("\n");
            }
          }
        } catch (e) {
          // ignore
        }
      }

      saveHidden();
      saveToStorage();
      drawWheel();
      rebuildList();
    });
    actions.appendChild(hideBtn);
    li.appendChild(actions);
    itemsUl.appendChild(li);
  });
  updateGamesHeader();
}

function updateGamesHeader() {
  const header = document.getElementById("gamesHeader");
  if (!header) return;
  const total = items.length;
  header.textContent = total + " " + (total === 1 ? "Game" : "Games");
}

function getVisibleItems() {
  return items.filter((it) => !it.hidden);
}

function drawWheel() {
  const list = getVisibleItems();
  const W = wheelCanvas.width,
    H = wheelCanvas.height,
    cx = W / 2,
    cy = H / 2,
    r = Math.min(cx, cy) - 8;
  ctx.clearRect(0, 0, W, H);
  if (list.length === 0) {
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No items", cx, cy);
    return;
  }

  // If winner animation is active, fill entire wheel with winner color and show centered text
  if (winnerAnimation.isAnimating && winnerAnimation.winnerIndex >= 0) {
    const winnerColor = colorForIndex(winnerAnimation.winnerIndex, list.length);
    const it = list[winnerAnimation.winnerIndex];

    // Fill entire wheel with winner color
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = winnerColor;
    ctx.fill();

    // Soft glow around wheel
    ctx.shadowColor = winnerColor;
    ctx.shadowBlur = 40;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Thicker subtle border
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Centered winner text with rounded translucent backdrop
    const maxTextWidth = r * 1.2;
    const baseFont = Math.max(18, Math.floor(r / 10));
    const fontSize = Math.floor(baseFont * winnerAnimation.scale);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Wrap lines to fit
    const lines = getWrappedLines(ctx, it.title, maxTextWidth);
    const lineHeight = Math.floor(fontSize * 1.05);
    const textBlockHeight = lines.length * lineHeight;

    // Measure widest line
    let widest = 0;
    for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
    const paddingX = Math.max(16, Math.floor(r * 0.06));
    const paddingY = Math.max(10, Math.floor(r * 0.03));
    const rectW = Math.min(widest, maxTextWidth) + paddingX * 2;
    const rectH = textBlockHeight + paddingY * 2;

    // Draw rounded backdrop
    const bw = rectW,
      bh = rectH,
      bx = cx - bw / 2,
      by = cy - bh / 2;
    const radius = Math.min(18, Math.floor(bh / 3));
    ctx.beginPath();
    ctx.moveTo(bx + radius, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, radius);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, radius);
    ctx.arcTo(bx, by + bh, bx, by, radius);
    ctx.arcTo(bx, by, bx + bw, by, radius);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();

    // Subtle border for backdrop
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw text lines with shadow and stroke for readability
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = Math.max(2, Math.floor(fontSize * 0.12));
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    for (let i = 0; i < lines.length; i++) {
      const txt = lines[i];
      const iy = cy - textBlockHeight / 2 + i * lineHeight + lineHeight / 2;
      ctx.strokeText(txt, cx, iy);
      ctx.fillText(txt, cx, iy);
    }
    ctx.shadowBlur = 0;
  } else {
    // Normal wheel drawing
    const seg = 360 / list.length;
    list.forEach((it, i) => {
      const start = ((i * seg + rotation) * Math.PI) / 180;
      const end = (((i + 1) * seg + rotation) * Math.PI) / 180;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = colorForIndex(i, list.length);
      ctx.fill();

      // labels
      const mid = (start + end) / 2;
      ctx.save();
      ctx.translate(
        cx + Math.cos(mid) * (r * 0.62),
        cy + Math.sin(mid) * (r * 0.62)
      );
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = "#fff";
      const fontSize = Math.max(12, Math.floor(r / 12));
      ctx.font = fontSize + "px sans-serif";
      ctx.textAlign = "center";
      wrapText(ctx, it.title, 0, 0, r * 0.6, Math.floor(r / 12) + 6);
      ctx.restore();
    });
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + (line ? " " : "") + words[n];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line);
      line = words[n];
    } else {
      line = testLine;
    }
  }
  lines.push(line);
  // center block
  const totalH = lines.length * lineHeight;
  let startY = y - totalH / 2 + lineHeight / 2;
  lines.forEach((l, i) => {
    ctx.fillText(l, x, startY + i * lineHeight);
  });
}

// Return array of wrapped lines (does not draw)
function getWrappedLines(ctx, text, maxWidth) {
  const words = text.split(" ");
  let line = "";
  let lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line ? line + " " + words[n] : words[n];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      lines.push(line);
      line = words[n];
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Easing helpers
function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function colorForIndex(i, n) {
  // pastel-ish hues
  const hue = Math.round((i / n) * 360);
  return `hsl(${hue} 70% 45%)`;
}

// Spin physics
function startSpin() {
  if (isSpinning) return;
  const list = getVisibleItems();
  if (list.length === 0) return alert("No visible items to spin");
  isSpinning = true;
  resultDiv.textContent = "";
  // choose random target index
  const targetIndex = Math.floor(Math.random() * list.length);
  // compute target rotation so that targetIndex lands at pointer (top)
  const seg = 360 / list.length;
  // we want the middle of target segment to be at -90deg (pointer top). rotation is applied when drawing, so finalRotation such that
  const targetMid = targetIndex * seg + seg / 2;
  // choose spins (full rotations) + offset
  const full = 6 + Math.floor(Math.random() * 4); // 6-9 full spins
  const finalRot = full * 360 + (270 - targetMid); // 270 because canvas 0deg at +x; pointer at top is -90 deg => 270
  // animate over duration
  const duration = 4000 + Math.random() * 2000; // 4-6s
  const start = performance.now();
  const startRot = rotation % 360;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    // ease out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    rotation = startRot + (finalRot - startRot) * eased;
    drawWheel();
    if (t < 1) {
      spinAnimationFrame = requestAnimationFrame(frame);
    } else {
      isSpinning = false;
      announceWinner(rotation);
    }
  }
  spinAnimationFrame = requestAnimationFrame(frame);
}

function announceWinner(finalRotation) {
  const list = getVisibleItems();
  const seg = 360 / list.length;
  const rot = ((finalRotation % 360) + 360) % 360; // 0-360
  // compute angle at pointer (top). Canvas 0deg is +x; pointer at top => 270deg. So angleAtTop = (360 - rot + 90) %360? Simpler compute which segment includes angle 270-rot
  const angleAtPointer = (270 - rot + 360) % 360;
  const index = Math.floor(angleAtPointer / seg) % list.length;
  const chosen = list[index];
  // Build result display with Hide/Unhide button
  resultDiv.innerHTML = "";
  if (chosen) {
    const a = document.createElement("a");
    a.href = chosen.url;
    a.target = "_blank";
    a.textContent = chosen.title;
    const label = document.createElement("span");
    label.textContent = " Selected: ";
    resultDiv.appendChild(label);
    resultDiv.appendChild(a);
    // find original item by URL to toggle hidden
    const orig =
      items.find((it) => it.url === chosen.url) ||
      items.find((it) => it.title === chosen.title);
    const btn = document.createElement("button");
    btn.style.marginLeft = "8px";
    btn.textContent = orig && orig.hidden ? "Unhide" : "Hide";
    btn.addEventListener("click", () => {
      if (!orig) return;
      orig.hidden = !orig.hidden;
      // If item was hidden via the result button, also remove its line(s) from the textarea
      if (orig.hidden) {
        try {
          const rawLines = (inputArea.value || "").split(/\r?\n/);
          const kept = rawLines.filter((line) => {
            const l = line.trim();
            if (!l) return false;
            const parts = l.split("\t");
            if (orig.url && parts.length >= 2) {
              return parts[1].trim() !== orig.url;
            }
            if (orig.url && l.includes(orig.url)) return false;
            if (orig.title && (l === orig.title || l.includes(orig.title)))
              return false;
            return true;
          });
          inputArea.value = kept.join("\n");
        } catch (e) {}
      } else {
        // unhidden: append back to textarea if not present
        try {
          const rawLines = (inputArea.value || "")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          const exists = rawLines.some((line) => {
            if (!line) return false;
            if (orig.url && line.includes(orig.url)) return true;
            if (
              orig.title &&
              (line === orig.title || line.includes(orig.title))
            )
              return true;
            return false;
          });
          if (!exists) {
            const toAdd =
              orig.title && orig.url
                ? `${orig.title}\t${orig.url}`
                : orig.url || orig.title || "";
            if (toAdd) {
              rawLines.push(toAdd);
              inputArea.value = rawLines.join("\n");
            }
          }
        } catch (e) {}
      }
      // persist and redraw
      saveHidden();
      saveToStorage();
      rebuildList();
      // stop winner overlay if any and redraw wheel
      winnerAnimation.isAnimating = false;
      drawWheel();
      // update button label
      btn.textContent = orig.hidden ? "Unhide" : "Hide";
    });
    resultDiv.appendChild(btn);
  } else {
    // Leave result empty so CSS can hide the result box when nothing is selected
    resultDiv.textContent = "        ";
  }

  // Start winner animation
  startWinnerAnimation(index);
}

function startWinnerAnimation(winnerIndex) {
  winnerAnimation.isAnimating = true;
  winnerAnimation.winnerIndex = winnerIndex;
  winnerAnimation.scale = 1.0;
  winnerAnimation.startTime = performance.now();

  const total = 3200; // ms
  const grow = 600; // grow duration
  const hold = 2000; // hold duration
  const shrink = total - grow - hold; // remaining

  function animateWinner(now) {
    const elapsed = now - winnerAnimation.startTime;
    if (elapsed < total) {
      if (elapsed < grow) {
        // ease out back for pop
        const t = easeOutBack(elapsed / grow);
        winnerAnimation.scale = 1 + t * 0.6; // up to 1.6
      } else if (elapsed < grow + hold) {
        winnerAnimation.scale = 1.6;
      } else {
        const t2 = (elapsed - grow - hold) / shrink;
        const t = easeOutQuad(1 - t2);
        winnerAnimation.scale = 1 + t * 0.6;
      }
      drawWheel();
      requestAnimationFrame(animateWinner);
    } else {
      winnerAnimation.isAnimating = false;
      winnerAnimation.scale = 1.0;
      drawWheel();
    }
  }

  requestAnimationFrame(animateWinner);
}

// Controls wiring

// Clear button
clearBtn.addEventListener("click", () => {
  items = [];
  saveToStorage();
  saveHidden();
  rebuildList();
  // Reset winner animation
  winnerAnimation.isAnimating = false;
  winnerAnimation.scale = 1.0;
  drawWheel();
  resultDiv.textContent = "";
  inputArea.value = "";
});

// Paste & Load button: read from clipboard and load parsed lines
pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return alert("Clipboard is empty");
    inputArea.value = text;
  } catch (e) {
    alert("Failed to read clipboard. Your browser may require permission.");
  }
});

// Load button: parse textarea and load items into the wheel
loadBtn.addEventListener("click", () => {
  const text = inputArea.value || "";
  const parsed = parseLines(text.trim());
  if (parsed.length === 0) return alert("No valid lines found to load");
  items = parsed;
  loadHidden();
  saveToStorage();
  rebuildList();
  drawWheel();
});

// Copy textarea contents to clipboard
copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inputArea.value || "");
    alert("Copied to clipboard");
  } catch (e) {
    alert("Failed to write to clipboard.");
  }
});
// no includeHidden option anymore
spinBtn.addEventListener("click", startSpin);

window.addEventListener("resize", () => {
  // keep canvas crisp
  // responsive: keep actual pixel backing store sized
  const rect = wheelCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  wheelCanvas.width = Math.floor(rect.width * ratio);
  wheelCanvas.height = Math.floor(rect.width * ratio);
  drawWheel();
});

// init
(function init() {
  // set a default canvas size for desktop
  const ratio = window.devicePixelRatio || 1;
  wheelCanvas.width = 600 * ratio;
  wheelCanvas.height = 600 * ratio;
  wheelCanvas.style.width = "600px";
  wheelCanvas.style.height = "600px";
  // load saved
  if (loadFromStorage()) {
    loadHidden();
  }
  rebuildList();
  drawWheel();
})();
