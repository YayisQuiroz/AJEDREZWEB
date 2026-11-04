const PIECES = "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png";
const E = id => document.getElementById(id);

const esc = t => String(t ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const game = new Chess();
let board = null;
let auth = JSON.parse(localStorage.getItem("chessAuth") || "null");   // { username, token }
let gameCode = null;
let myColor = null;          // "white" | "black"
let finished = null;         // "1-0" | "0-1" | "1/2-1/2"
let lastState = null;
let overShown = false;
let pollTimer = null;
let legalTargets = new Set();

// ---------- API ----------
async function api(path, method = "GET", body) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers["X-Auth-Token"] = auth.token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Error del servidor");
    err.status = res.status;
    throw err;
  }
  return data;
}

function show(id) {
  ["authView", "lobby", "game", "replay"].forEach(v => E(v).hidden = v !== id);
}

// ---------- Login / registro ----------
async function doAuth(kind) {
  try {
    const r = await api(`/api/auth/${kind}`, "POST",
      { username: E("username").value.trim(), password: E("password").value });
    auth = { username: r.username, token: r.token };
    localStorage.setItem("chessAuth", JSON.stringify(auth));
    E("authMsg").textContent = "";
    await enterLobby();
  } catch (e) { E("authMsg").textContent = e.message; }
}
E("btnLogin").onclick = () => doAuth("login");
E("btnRegister").onclick = () => doAuth("register");
E("password").onkeydown = e => { if (e.key === "Enter") doAuth("login"); };

function logout() {
  localStorage.removeItem("chessAuth");
  localStorage.removeItem("chessGame");
  location.reload();
}
E("btnLogout").onclick = logout;

// ---------- Lobby ----------
async function enterLobby() {
  show("lobby");
  E("welcome").textContent = `Hola, ${auth.username}`;
  try {
    const me = await api("/api/auth/me");
    E("stats").innerHTML =
      `<span class="chip">Partidas <b>${me.played}</b></span>` +
      `<span class="chip">Ganadas <b>${me.wins}</b></span>` +
      `<span class="chip">Perdidas <b>${me.losses}</b></span>` +
      `<span class="chip">Tablas <b>${me.draws}</b></span>`;
  } catch (e) { if (e.status === 401) return logout(); }

  loadHistory();

  const saved = localStorage.getItem("chessGame");
  if (saved) { gameCode = saved; startPolling(); }
}

function setGame(code) {
  gameCode = code;
  localStorage.setItem("chessGame", code);
}

E("btnCreate").onclick = async () => {
  try {
    const r = await api("/api/games", "POST", { minutes: parseInt(E("timeSelect").value) });
    setGame(r.code);
    startPolling();
  } catch (e) { E("lobbyMsg").textContent = e.message; }
};

E("btnJoin").onclick = async () => {
  const code = E("codeInput").value.trim().toUpperCase();
  try {
    await api(`/api/games/${code}/join`, "POST");
    setGame(code);
    startPolling();
  } catch (e) { E("lobbyMsg").textContent = e.message; }
};

async function loadHistory() {
  try {
    const list = await api("/api/games?mine=true");
    E("history").innerHTML = list.map(g => {
      const vs = `${g.white} vs ${g.black ?? "?"}`;
      const res = g.result ? ` (${g.result})` : "";
      const time = g.minutes ? `${g.minutes} min` : "∞";
      const cont = g.status !== "finished"
        ? `<button class="small" data-continue="${g.code}">Continuar</button>` : "";
      return `<li><b>${g.code}</b> · ${vs} · ${g.status}${res} · ${time} · ${g.moveCount} jug.
              <button class="small secondary" data-code="${g.code}">Ver</button>${cont}</li>`;
    }).join("") || "<li>Aún no has jugado.</li>";
  } catch { /* sin historial */ }
}

E("history").onclick = e => {
  if (e.target.dataset.code) openReplay(e.target.dataset.code);
  if (e.target.dataset.continue) { setGame(e.target.dataset.continue); startPolling(); }
};

// ---------- Polling (sincroniza con el servidor) ----------
function startPolling() {
  clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, 1500);
}

async function poll() {
    let s;
    try {
        s = await api(`/api/games/${gameCode}`);
    } catch (e) {                                   // falló la red o el servidor
        if (e.status === 404) return exit(true);
        if (e.status === 401) return logout();
        console.error("Red/servidor:", e);
        showErr("Sin respuesta del servidor: " + e.message);
        return;
    }
    try {
        sync(s);                                      // falló el dibujo en pantalla
    } catch (e) {
        console.error("Error al dibujar:", e);
        showErr("Error en pantalla: " + e.message);
    }
}

function showErr(msg) {
    E("banner").textContent = msg;
    E("lobbyMsg").textContent = msg;
}

function sync(s) {
  lastState = s;

    if (s.status === "waiting") {
        const box = E("lobbyMsg");
        // se dibuja una sola vez; si no, cada poll (1.5 s) borraría el "✓ Copiado"
        if (!box.querySelector(`[data-copy="${s.code}"]`)) {
            box.innerHTML = `Comparte este código:<br><span class="code-box">${s.code}</span>
      <button class="small" data-copy="${s.code}">📋 Copiar</button><br>Esperando al rival...`;
        }
        return;
    }

    if (!board) startBoard(s);
    if (!board) { clearInterval(pollTimer); return; }

  // aplicar jugadas que aún no tenemos
  const have = game.history().length;
  if (s.moves.length > have) {
    s.moves.slice(have).forEach(m =>
      game.move({ from: m.from, to: m.to, promotion: m.promotion || undefined }));
    board.position(game.fen());
  }

  // no pisar el reloj si ya hicimos una jugada local que el servidor aún no confirma
  if (s.moves.length >= game.history().length) setClock(s);

  if (s.result) {
    finished = s.result;
    clock.running = false;
    clearInterval(pollTimer);
  }

  paintLastMove();
  renderMoves();
  updateStatus();
  renderClocks();
  if (finished) showGameOver(s);
}

// ---------- Reloj ----------
const clock = { w: 0, b: 0, at: 0, turn: "w", running: false, timed: false };
let lastTimeoutPoll = 0;

function setClock(s) {
  clock.timed = s.timeControl > 0;
  clock.w = s.whiteTimeMs;
  clock.b = s.blackTimeMs;
  clock.at = performance.now();
  clock.turn = s.turn === "white" ? "w" : "b";
  clock.running = s.status === "playing";
}

function clockNow(side) {
  let v = side === "w" ? clock.w : clock.b;
  if (clock.timed && clock.running && clock.turn === side) v -= performance.now() - clock.at;
  return Math.max(0, v);
}

function fmt(ms) {
  const t = Math.ceil(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function renderClocks() {
  if (!myColor) return;
  const top = myColor === "white" ? "b" : "w";
  const bot = myColor === "white" ? "w" : "b";

  [["top", top], ["bottom", bot]].forEach(([pos, side]) => {
    const ms = clockNow(side);
    const el = E(pos + "Clock");
    el.textContent = clock.timed ? fmt(ms) : "∞";
    el.classList.toggle("low", clock.timed && clock.running && ms <= 30000);
    E(pos + "Bar").classList.toggle("active", clock.running && clock.turn === side);
  });

  // si el tiempo local llegó a 0, pedir al servidor que lo confirme
  if (clock.timed && clock.running && !finished && clockNow(clock.turn) <= 0
      && Date.now() - lastTimeoutPoll > 1000) {
    lastTimeoutPoll = Date.now();
    poll();
  }
}
setInterval(renderClocks, 200);

// al mover localmente, el reloj cambia de lado de inmediato
function switchClockLocally() {
  if (clock.timed) {
    const v = clockNow(clock.turn);
    if (clock.turn === "w") clock.w = v; else clock.b = v;
  }
  clock.turn = clock.turn === "w" ? "b" : "w";
  clock.at = performance.now();
}

// ---------- Tablero ----------
function startBoard(s) {
  myColor = s.whiteName === auth.username ? "white" : "black";
  show("game");

  const opp = myColor === "white" ? s.blackName : s.whiteName;
  E("topName").textContent = `${myColor === "white" ? "⚫" : "⚪"} ${opp}`;
  E("bottomName").textContent = `${myColor === "white" ? "⚪" : "⚫"} ${auth.username} (tú)`;
  E("info").textContent =
    `Código ${s.code} · ${s.timeControl ? s.timeControl / 60 + " min por jugador" : "sin límite de tiempo"}`;

  board = Chessboard("board", {
    draggable: true,
    position: game.fen(),
    orientation: myColor,
    pieceTheme: PIECES,
    onDragStart, onDragMove, onDrop, onSnapEnd
  });
}

window.addEventListener("resize", () => {
    if (board) { board.resize(); paintLastMove(); }
    if (rBoard && !E("replay").hidden) rBoard.resize();
});

function isMyTurn() {
  return (game.turn() === "w" && myColor === "white") ||
         (game.turn() === "b" && myColor === "black");
}

// --- resaltados ---
const sqEl = sq => document.querySelector("#board .square-" + sq);

function clearHighlights() {
  document.querySelectorAll("#board .hl-legal, #board .hl-illegal, #board .hl-hover, #board .hl-from")
    .forEach(el => el.classList.remove("hl-legal", "hl-illegal", "hl-hover", "hl-from"));
}

function paintLastMove() {
  document.querySelectorAll("#board .last-move").forEach(el => el.classList.remove("last-move"));
  const h = game.history({ verbose: true });
  if (!h.length) return;
  const m = h[h.length - 1];
  [m.from, m.to].forEach(sq => sqEl(sq)?.classList.add("last-move"));
}

function onDragStart(source, piece) {
  if (finished || game.game_over() || !isMyTurn()) return false;
  if (myColor === "white" && piece.startsWith("b")) return false;
  if (myColor === "black" && piece.startsWith("w")) return false;

  // casillas a las que SÍ puede ir → verde
  const moves = game.moves({ square: source, verbose: true });
  legalTargets = new Set(moves.map(m => m.to));
  sqEl(source)?.classList.add("hl-from");
  legalTargets.forEach(sq => sqEl(sq)?.classList.add("hl-legal"));
}

// casilla bajo el cursor: verde fuerte si es legal, ROJO si no lo es
function onDragMove(newLocation, oldLocation, source) {
  document.querySelectorAll("#board .hl-illegal, #board .hl-hover")
    .forEach(el => el.classList.remove("hl-illegal", "hl-hover"));
  if (newLocation === "offboard" || newLocation === source) return;
  sqEl(newLocation)?.classList.add(legalTargets.has(newLocation) ? "hl-hover" : "hl-illegal");
}

function onDrop(source, target) {
  clearHighlights();
  const move = game.move({ from: source, to: target, promotion: "q" });
  if (move === null) return "snapback";   // jugada ilegal

  const result = game.in_checkmate() ? (game.turn() === "w" ? "0-1" : "1-0")
               : game.in_draw() ? "1/2-1/2" : null;

  if (result) clock.running = false; else switchClockLocally();
  paintLastMove();
  renderMoves();
  updateStatus();
  sendMove(source, target, move.promotion || null, result);
}

async function sendMove(from, to, promotion, result) {
  let s;
  try {
    s = await api(`/api/games/${gameCode}/moves`, "POST",
      { from, to, promotion, fen: game.fen(), result });
  } catch (e) {                           // el servidor la rechazó: deshacer y resincronizar
    game.undo();
    board.position(game.fen());
    paintLastMove();
    renderMoves();
    E("banner").textContent = e.message;
    poll();
    return;
  }
  sync(s);
}

function onSnapEnd() { board.position(game.fen()); }

// ---------- Panel lateral ----------
function renderMoves() {
    // Icono de la pieza + coordenadas (a-h, 1-8)
    const h = game.history({ verbose: true }).map(m => {
        const icon = PIECES.replace("{piece}", m.color + m.piece.toUpperCase());   
        return `<span class="pbox ${m.color}"><img class="pi" src="${icon}" alt=""></span>` +
            `${m.from} → ${m.to}${m.promotion ? " =" + m.promotion.toUpperCase() : ""}`;
    });

    let html = "";
    for (let i = 0; i < h.length; i += 2) {
        const wLast = i === h.length - 1 ? " last" : "";
        const bLast = i + 1 === h.length - 1 ? " last" : "";
        html += `<div class="mrow"><span class="mn">${i / 2 + 1}.</span>` +
            `<span class="m${wLast}">${h[i]}</span><span class="m${bLast}">${h[i + 1] ?? ""}</span></div>`;
    }
    const box = E("moves");
    box.innerHTML = html || '<p class="muted">Aún no hay jugadas.</p>';
    box.scrollTop = box.scrollHeight;
    renderCaptured();
}

// ---------- Piezas comidas ----------
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const PIECE_ES = {
    p: ["un peón", "el peón"], n: ["un caballo", "el caballo"], b: ["un alfil", "el alfil"],
    r: ["una torre", "la torre"], q: ["una dama", "la dama"]
};
let alertKey = -1;

function renderCaptured() {
    if (!myColor || !lastState) return;
    const hist = game.history({ verbose: true });
    const mine = myColor === "white" ? "w" : "b";
    const oppName = myColor === "white" ? lastState.blackName : lastState.whiteName;

    E("topCapTitle").textContent = `Comió ${oppName}`;
    E("bottomCapTitle").textContent = "Comiste tú";

    const byColor = { w: [], b: [] };                     // byColor.w = piezas que capturaron las blancas
    hist.forEach(m => { if (m.captured) byColor[m.color].push(m.captured); });

    const order = "qrbnp";
    const value = arr => arr.reduce((s, p) => s + PIECE_VALUE[p], 0);

    const draw = (boxId, capturer) => {
        const other = capturer === "w" ? "b" : "w";         // las piezas comidas son del color contrario
        const arr = byColor[capturer].slice().sort((x, y) => order.indexOf(x) - order.indexOf(y));
        const diff = value(byColor[capturer]) - value(byColor[other]);
        const el = E(boxId);
        el.className = "captured cap-" + other;
        el.innerHTML =
            (arr.map(p => `<img src="${PIECES.replace("{piece}", other + p.toUpperCase())}" alt="">`).join("")
                || '<span class="none">sin capturas</span>') +
            (diff > 0 ? `<span class="adv">+${diff}</span>` : "");
    };

    draw("bottomCaptured", mine);                         // lo que comí yo
    draw("topCaptured", mine === "w" ? "b" : "w");        // lo que comió el rival
    renderCaptureAlert(hist);
}

// Banner con la ÚLTIMA captura (se queda visible hasta que haya otra)
function renderCaptureAlert(hist) {
    if (hist.length === alertKey) return;                 // solo se redibuja cuando hay jugada nueva
    alertKey = hist.length;

    const el = E("captureAlert");
    let idx = -1;
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i].captured) { idx = i; break; }

    if (idx < 0) {
        el.className = "capture-alert none";
        el.innerHTML = "<span>Aún no hay capturas</span>";
        return;
    }

    const m = hist[idx];
    const fresh = idx === hist.length - 1;                // ¿la captura fue en la última jugada?
    const mineMove = m.color === (myColor === "white" ? "w" : "b");
    const lost = m.color === "w" ? "b" : "w";
    const icon = PIECES.replace("{piece}", lost + m.captured.toUpperCase());
    const text = mineMove ? `¡Capturaste ${PIECE_ES[m.captured][0]}!`
        : `¡Te comieron ${PIECE_ES[m.captured][1]}!`;

    el.className = "capture-alert " + (mineMove ? "good" : "bad") + (fresh ? " fresh" : " old");
    el.innerHTML = `<span class="cap-icon cap-${lost}"><img src="${icon}" alt=""></span>` +
        `<span>${text}<small>Jugada ${idx + 1} · ${m.from} → ${m.to}${fresh ? " · ahora" : ""}</small></span>`;
}

function updateStatus() {
    const b = E("banner");
    const chk = E("checkAlert");
    chk.hidden = true;

    if (finished) {
        const s = lastState;
        const winner = finished === "1-0" ? s.whiteName : finished === "0-1" ? s.blackName : null;
        b.textContent = winner ? `🏆 Ganó ${winner}` : "🤝 Tablas";
        b.className = "banner end";
        return;
    }

    if (isMyTurn()) { b.textContent = "Es tu turno"; b.className = "banner mine"; }
    else { b.textContent = "Turno del rival…"; b.className = "banner theirs"; }

    if (game.in_check() && !game.in_checkmate()) {
        const mine = isMyTurn();                       // si me toca mover y hay jaque, es a mi rey
        chk.className = "check-alert " + (mine ? "danger" : "giving");
        chk.innerHTML = mine
            ? "⚠ ¡Estás en jaque!<small>Protege a tu rey</small>"
            : " ¡Jaque al rey rival!<small>Su rey está bajo ataque</small>";
        chk.hidden = false;
    }
}

// ---------- Fin de la partida ----------
function reasonText(s) {
  const loser = s.result === "1-0" ? s.blackName : s.whiteName;
  switch (s.endReason) {
    case "checkmate": return "Por jaque mate";
    case "timeout":   return `Se acabó el tiempo de ${loser}`;
    case "resign":    return `${loser} se rindió`;
    case "draw":      return "Tablas (empate)";
    default:          return "";
  }
}

function showGameOver(s) {
  if (overShown) return;
  overShown = true;
  localStorage.removeItem("chessGame");   // al recargar ya no reabre esta partida

  const res = s.result;
  const winner = res === "1-0" ? s.whiteName : res === "0-1" ? s.blackName : null;
  const iWon = (res === "1-0" && myColor === "white") || (res === "0-1" && myColor === "black");

  E("overWinner").textContent = winner ? `🏆 Ganador: ${winner}` : "🤝 Tablas";
  E("overPersonal").textContent = !winner ? "Empate" : iWon ? "¡Ganaste!" : "Perdiste";
  E("overReason").textContent = reasonText(s);
  E("gameOver").hidden = false;
}

E("btnOverBoard").onclick = () => { E("gameOver").hidden = true; };
E("btnOverLobby").onclick = () => exit(true);
E("btnOverReplay").onclick = () => { E("gameOver").hidden = true; openReplay(lastState.code); };

E("btnResign").onclick = async () => {
  if (finished || !confirm("¿Seguro que quieres rendirte?")) return;
  try { sync(await api(`/api/games/${gameCode}/resign`, "POST")); }
  catch (e) { E("banner").textContent = e.message; }
};

function exit(force) {
  if (force !== true && !finished &&
      !confirm("La partida sigue en curso y tu reloj seguirá corriendo. ¿Salir de todos modos?")) return;
  localStorage.removeItem("chessGame");
  location.reload();
}
E("btnExit").onclick = () => exit();

// ---------- Repetición de partidas ----------
let rBoard, rGame, rVerbose, rIdx;

// Jugada con icono de pieza + coordenadas (mismo formato que el panel de la partida)
function moveHtml(m) {
    const icon = PIECES.replace("{piece}", m.color + m.piece.toUpperCase());
    return `<span class="pbox ${m.color}"><img class="pi" src="${icon}" alt=""></span>` +
        `${m.from} → ${m.to}${m.promotion ? " =" + m.promotion.toUpperCase() : ""}`;
}

async function openReplay(code) {
    const s = await api(`/api/games/${code}`);

    // Reconstruir la partida completa para conocer qué pieza se movió en cada jugada
    const full = new Chess();
    s.moves.forEach(m => full.move({ from: m.from, to: m.to, promotion: m.promotion || undefined }));
    rVerbose = full.history({ verbose: true });
    rGame = new Chess();
    rIdx = 0;

    show("replay");

    // Nombres y resultado
    const winner = s.result === "1-0" ? s.whiteName : s.result === "0-1" ? s.blackName : null;
    E("rTopName").innerHTML = `⚫ ${esc(s.blackName ?? "?")}${s.result === "0-1" ? " 🏆" : ""}`;
    E("rBottomName").innerHTML = `⚪ ${esc(s.whiteName)}${s.result === "1-0" ? " 🏆" : ""}`;
    E("replayBanner").textContent = winner ? `🏆 Ganó ${winner}` : s.result ? "🤝 Tablas" : "Partida en curso";
    E("replayInfo").textContent =
        `Código ${s.code} · ${s.timeControl ? s.timeControl / 60 + " min por jugador" : "sin límite de tiempo"}` +
        (s.result ? ` · ${reasonText(s)}` : "");

    rBoard = Chessboard("replayBoard", { position: "start", pieceTheme: PIECES });
    renderReplay();
    requestAnimationFrame(() => rBoard.resize());   // recalcula el tamaño cuando la pantalla ya se acomodó
}

function renderReplay() {
    rBoard.position(rGame.fen());
    E("replayStep").textContent = `Jugada ${rIdx} de ${rVerbose.length}`;

    let html = "";
    for (let i = 0; i < rVerbose.length; i += 2) {
        const w = i + 1 === rIdx ? " last" : "";           // resalta la jugada actual
        const b = i + 2 === rIdx ? " last" : "";
        html += `<div class="mrow"><span class="mn">${i / 2 + 1}.</span>` +
            `<span class="m${w}">${moveHtml(rVerbose[i])}</span>` +
            `<span class="m${b}">${rVerbose[i + 1] ? moveHtml(rVerbose[i + 1]) : ""}</span></div>`;
    }
    const box = E("replayMoves");
    box.innerHTML = html || '<p class="muted">Sin jugadas.</p>';
    box.querySelector(".last")?.scrollIntoView({ block: "nearest" });
}

function stepReplay(d) {
    if (d > 0 && rIdx < rVerbose.length) {
        const m = rVerbose[rIdx++];
        rGame.move({ from: m.from, to: m.to, promotion: m.promotion });
    } else if (d < 0 && rIdx > 0) {
        rGame.undo(); rIdx--;
    }
    renderReplay();
}

E("btnPrev").onclick = () => stepReplay(-1);
E("btnNext").onclick = () => stepReplay(1);
E("btnBack").onclick = () => exit(true);

// flechas del teclado ← →
document.addEventListener("keydown", e => {
    if (E("replay").hidden) return;
    if (e.key === "ArrowRight") stepReplay(1);
    if (e.key === "ArrowLeft") stepReplay(-1);
});

function copyText(text) {
    // navigator.clipboard solo existe en HTTPS o localhost; desde http://192.168.x.x no está disponible
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const t = document.createElement("textarea");
    t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    document.execCommand("copy");
    t.remove();
    return Promise.resolve();
}

// Un solo listener para cualquier botón con data-copy="..."
document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    await copyText(btn.dataset.copy);
    const old = btn.textContent;
    btn.textContent = "✓ Copiado";
    setTimeout(() => btn.textContent = old, 1500);
});
// ---------- Inicio ----------
if (auth) enterLobby(); else show("authView");
