// ==============================
// MIRA Agent Web (Copiloto + Planner + Tools)
// - Chat UI
// - Task window (plan/logs)
// - Agent states
// - Voice (WebSpeech)
// - Backend connection (Render) ✅
// - Actions: open_url (frontend) ✅
// - Remote Control Mode (optional): screenshot + click + type ✅ (si backend lo soporta)
// ==============================

// ------- DOM -------
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

const newChatBtn = document.getElementById("newChatBtn");
const openTaskBtn = document.getElementById("openTaskBtn");
const toggleVoiceBtn = document.getElementById("toggleVoiceBtn");

const taskWindow = document.getElementById("taskWindow");
const closeTaskBtn = document.getElementById("closeTaskBtn");
const taskLogEl = document.getElementById("taskLog");
const taskFrame = document.getElementById("taskFrame");

const agentStateEl = document.getElementById("agentState");
const agentHintEl = document.getElementById("agentHint");

const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const takeOverBtn = document.getElementById("takeOverBtn");

const netStatusEl = document.getElementById("netStatus");

// ----- Mode buttons -----
const modeIframeBtn = document.getElementById("modeIframeBtn");
const modeRemoteBtn = document.getElementById("modeRemoteBtn");
const iframeBox = document.getElementById("iframeBox");
const remoteBox = document.getElementById("remoteBox");

// ----- Remote UI -----
const btnRemoteStart = document.getElementById("btnRemoteStart");
const btnRemoteShot = document.getElementById("btnRemoteShot");
const btnRemoteGoto = document.getElementById("btnRemoteGoto");
const remoteUrlInput = document.getElementById("remoteUrlInput");
const btnRemoteType = document.getElementById("btnRemoteType");
const remoteTypeInput = document.getElementById("remoteTypeInput");
const remoteScreen = document.getElementById("remoteScreen");

const btnKeyEnter = document.getElementById("btnKeyEnter");
const btnKeyBackspace = document.getElementById("btnKeyBackspace");
const btnKeyTab = document.getElementById("btnKeyTab");
const btnKeyEsc = document.getElementById("btnKeyEsc");
const btnKeyCtrlL = document.getElementById("btnKeyCtrlL");

// ✅ Backend Render
const BACKEND_URL = "https://mira-agent.onrender.com";

// ------- Session (memoria por sessionId en backend) -------
const sessionId = localStorage.getItem("mira_session_id") || crypto.randomUUID();
localStorage.setItem("mira_session_id", sessionId);

// ------- Voice -------
let voiceEnabled = true;

// ------- Agent states -------
const AgentState = {
  IDLE: "IDLE",
  PLANNING: "PLANNING",
  WAITING_USER: "WAITING_USER",
  EXECUTING: "EXECUTING",
  OBSERVING: "OBSERVING",
  RECOVERING: "RECOVERING",
  DONE: "DONE",
};
let currentState = AgentState.IDLE;

// ------- Remote mode -------
const RemoteViewport = { width: 1280, height: 720 }; // debe coincidir con backend
let uiMode = localStorage.getItem("mira_ui_mode") || "iframe"; // iframe | remote
let remoteReady = false;

// ==============================
// UI Helpers
// ==============================
function setState(state, hint = "") {
  currentState = state;
  agentStateEl.textContent = state;
  agentHintEl.textContent = hint || " ";
}

function openTaskWindow() {
  taskWindow.classList.remove("hidden");
}
function closeTaskWindow() {
  taskWindow.classList.add("hidden");
}

function logTask(text) {
  const li = document.createElement("li");
  li.textContent = text;
  taskLogEl.appendChild(li);
  taskLogEl.scrollTop = taskLogEl.scrollHeight;
}

function clearTaskLog() {
  taskLogEl.innerHTML = "";
}

function addMessage(text, who = "mira") {
  const div = document.createElement("div");
  div.className = `message ${who}`;
  div.innerHTML = sanitizeHTML(text);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = who === "user" ? "Tú" : "MIRA";

  div.appendChild(meta);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function sanitizeHTML(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ==============================
// Typing indicator
// ==============================
function showTyping(on) {
  const id = "typing";
  let el = document.getElementById(id);

  if (on) {
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.className = "message mira";
      el.innerHTML = "MIRA está escribiendo…";
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = "MIRA";
      el.appendChild(meta);
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } else {
    if (el) el.remove();
  }
}

// ==============================
// Voice (WebSpeech)
// ==============================
function stripDoNotRead(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$[^$]*\$/g, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "")
    .trim();
}

function speak(text) {
  if (!voiceEnabled) return;
  if (!("speechSynthesis" in window)) return;

  const clean = stripDoNotRead(text);
  if (!clean) return;

  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "es-CL";
  u.rate = 1.02;

  window.speechSynthesis.speak(u);
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  toggleVoiceBtn.textContent = voiceEnabled ? "🔊 Voz" : "🔇 Voz";
  const msg = voiceEnabled ? "Voz activada." : "Voz desactivada.";
  addMessage(msg, "mira");
  speak(msg);
}

// ==============================
// Mode switch (iframe/remote)
// ==============================
function applyMode(mode) {
  uiMode = mode;
  localStorage.setItem("mira_ui_mode", uiMode);

  if (mode === "remote") {
    iframeBox?.classList.add("hidden");
    remoteBox?.classList.remove("hidden");
    modeRemoteBtn?.classList.add("btn-primary");
    modeRemoteBtn?.classList.remove("btn-ghost");
    modeIframeBtn?.classList.remove("btn-primary");
    modeIframeBtn?.classList.add("btn-ghost");
    logTask("🖥 Modo: Control real (si backend lo soporta).");
  } else {
    remoteBox?.classList.add("hidden");
    iframeBox?.classList.remove("hidden");
    modeIframeBtn?.classList.add("btn-primary");
    modeIframeBtn?.classList.remove("btn-ghost");
    modeRemoteBtn?.classList.remove("btn-primary");
    modeRemoteBtn?.classList.add("btn-ghost");
    logTask("🧩 Modo: Iframe (puede ser bloqueado por algunos sitios).");
  }
}

modeIframeBtn?.addEventListener("click", () => applyMode("iframe"));
modeRemoteBtn?.addEventListener("click", () => applyMode("remote"));

// ==============================
// Copiloto web (iframe + fallback)
// ==============================
function openInTaskIframe(url) {
  openTaskWindow();
  if (!taskFrame) return;

  taskFrame.src = url;
  logTask("🌐 Abriendo en ventana (iframe): " + url);
  logTask("↗ Si no se ve, el sitio bloquea iframe. Cambia a Control real o abre en pestaña: " + url);
}

// ==============================
// Remote Control API (optional)
// Backend debe implementar /api/browser/*
// ==============================
async function remoteStart() {
  const r = await fetch(`${BACKEND_URL}/api/browser/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "No se pudo iniciar navegador remoto");
  if (data.screenshotBase64) {
    remoteScreen.src = `data:image/png;base64,${data.screenshotBase64}`;
  }
  remoteReady = true;
  logTask("✅ Navegador remoto iniciado.");
  return data;
}

async function remoteShot() {
  const r = await fetch(`${BACKEND_URL}/api/browser/screenshot?sessionId=${encodeURIComponent(sessionId)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "No se pudo capturar pantalla");
  if (data.screenshotBase64) {
    remoteScreen.src = `data:image/png;base64,${data.screenshotBase64}`;
  }
  return data;
}

async function remoteGoto(url) {
  const r = await fetch(`${BACKEND_URL}/api/browser/goto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, url })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "No se pudo navegar");
  if (data.screenshotBase64) {
    remoteScreen.src = `data:image/png;base64,${data.screenshotBase64}`;
  }
  return data;
}

async function remoteClick(x, y) {
  const r = await fetch(`${BACKEND_URL}/api/browser/click`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, x, y })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "No se pudo hacer click");
  if (data.screenshotBase64) {
    remoteScreen.src = `data:image/png;base64,${data.screenshotBase64}`;
  }
  return data;
}

async function remoteType(text) {
  const r = await fetch(`${BACKEND_URL}/api/browser/type`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, text })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "No se pudo escribir");
  if (data.screenshotBase64) {
    remoteScreen.src = `data:image/png;base64,${data.screenshotBase64}`;
  }
  return data;
}

async function remoteKey(key) {
  const r = await fetch(`${BACKEND_URL}/api/browser/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, key })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "No se pudo enviar tecla");
  if (data.screenshotBase64) {
    remoteScreen.src = `data:image/png;base64,${data.screenshotBase64}`;
  }
  return data;
}

// ==============================
// Agent heuristics (frontend hint)
// ==============================
function looksLikeTask(userText) {
  const t = (userText || "").toLowerCase();
  const verbs = [
    "abre","abrir",
    "buscar","busca",
    "rellena","rellenar",
    "completa","completar",
    "envía","enviar",
    "manda","mandar",
    "descarga","descargar",
    "sube","subir",
    "publica","publicar",
    "crea","crear",
    "pon","reproduce","reproducir"
  ];
  return verbs.some(v => t.includes(v));
}

// ==============================
// Backend (chat)
// ==============================
async function callBackend(userText) {
  const r = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, userText }),
  });

  let data = null;
  try { data = await r.json(); } catch {}

  if (!r.ok) {
    const msg = data?.error || "Backend error";
    throw new Error(msg);
  }
  return data; // { assistantText, agent?, actions? }
}

function setNet(ok, msg){
  if (!netStatusEl) return;
  netStatusEl.textContent = msg;
  netStatusEl.classList.remove("good","bad");
  netStatusEl.classList.add(ok ? "good" : "bad");
}

// ==============================
// Render Agent Plan + Logs
// ==============================
function renderAgent(agent) {
  if (!agent) return;

  const hasPlan = !!agent.plan;
  const hasLogs = Array.isArray(agent.logs) && agent.logs.length > 0;

  if (hasPlan || hasLogs) openTaskWindow();

  if (agent.state && AgentState[agent.state]) {
    setState(agent.state, "Procesando…");
  }

  if (hasPlan) {
    logTask("— PLAN —");
    logTask(`🧠 Objetivo: ${agent.plan.goal}`);
    (agent.plan.steps || []).forEach((s, i) => logTask(`${i + 1}. ${s}`));
    if (agent.plan.needs_user?.length) logTask(`🙋 Necesito de ti: ${agent.plan.needs_user.join(" | ")}`);
    if (agent.plan.confirm_required) logTask("🔒 Requiere confirmación explícita antes de continuar.");
  }

  if (hasLogs) {
    logTask("— LOGS —");
    agent.logs.forEach(line => logTask(line));
  }
}

async function runActions(actions){
  if (!Array.isArray(actions)) return;

  for (const a of actions) {
    if (!a || typeof a !== "object") continue;

    if (a.type === "open_url" && a.url) {
      openTaskWindow();
      logTask("🧠 Acción: open_url -> " + a.url);

      // Si estás en modo remote intentamos control real, si falla caemos a iframe
      if (uiMode === "remote") {
        try {
          if (!remoteReady) await remoteStart();
          await remoteGoto(a.url);
          remoteUrlInput.value = a.url;
        } catch (e) {
          logTask("⚠ Control real no disponible (backend). Fallback a iframe.");
          openInTaskIframe(a.url);
          applyMode("iframe");
        }
      } else {
        openInTaskIframe(a.url);
      }
    }
  }
}

// ==============================
// Main send
// ==============================
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage(text, "user");
  inputEl.value = "";

  setState(AgentState.IDLE, "Conversando…");
  showTyping(true);

  if (looksLikeTask(text)) {
    openTaskWindow();
    setState(AgentState.PLANNING, "Analizando tarea…");
    logTask("📌 Tarea detectada (modo copiloto).");
    logTask("🔒 Si aparece login, tú ingresas credenciales manualmente.");
  }

  try {
    setNet(true, "Conectando…");
    const data = await callBackend(text);
    showTyping(false);

    setNet(true, "Online ✅");

    // Ejecuta acciones (por ejemplo open_url)
    await runActions(data.actions);

    // Render plan/logs si vienen del backend
    renderAgent(data.agent);

    const reply = data.assistantText || "No pude responder.";
    addMessage(reply, "mira");
    speak(reply);

    if (data.agent?.plan?.confirm_required) {
      setState(AgentState.WAITING_USER, "Esperando tu confirmación…");
    } else {
      setState(AgentState.IDLE, "Lista para trabajar.");
    }

  } catch (e) {
    showTyping(false);
    setNet(false, "Offline / Error");
    setState(AgentState.RECOVERING, "Problema de conexión.");
    addMessage("Tuve un problema conectando con el servidor. Revisa Render/URL.", "mira");
    logTask("⚠ Error: " + (e?.message || "desconocido"));
  }
}

// ==============================
// Events
// ==============================
sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

newChatBtn.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  clearTaskLog();
  setState(AgentState.IDLE, "Lista para trabajar.");
  addMessage("Hola, soy MIRA. Ya tengo cerebro cloud conectado. Dime qué hacemos.", "mira");
  speak("Hola, soy MIRA. Ya tengo cerebro cloud conectado. Dime qué hacemos.");
});

openTaskBtn.addEventListener("click", openTaskWindow);
closeTaskBtn.addEventListener("click", closeTaskWindow);
toggleVoiceBtn.addEventListener("click", toggleVoice);

pauseBtn.addEventListener("click", () => {
  logTask("⏸ Pausa solicitada por el usuario.");
  setState(AgentState.WAITING_USER, "Pausada. Puedes continuar cuando quieras.");
});

resumeBtn.addEventListener("click", () => {
  logTask("▶ Continuar solicitado por el usuario.");
  setState(AgentState.EXECUTING, "Reanudando…");
  setTimeout(() => setState(AgentState.OBSERVING, "Verificando…"), 600);
  setTimeout(() => setState(AgentState.DONE, "Listo."), 1200);
});

takeOverBtn.addEventListener("click", () => {
  logTask("🧑‍✈️ El usuario tomó el control (modo seguro).");
  setState(AgentState.WAITING_USER, "Tú tienes el control. Yo te guío.");
  addMessage("Perfecto. Tú tomas el control. Dime qué ves en pantalla y te guío paso a paso.", "mira");
  speak("Perfecto. Tú tomas el control. Te guío paso a paso.");
});

// ==============================
// Remote events (si usas modo remote)
// ==============================
btnRemoteStart?.addEventListener("click", async () => {
  openTaskWindow();
  applyMode("remote");
  logTask("🟢 Iniciando navegador remoto…");
  try {
    await remoteStart();
  } catch (e) {
    logTask("⚠ No se pudo iniciar remote: " + (e?.message || "error"));
    logTask("↘ Cambiando a iframe para que no se rompa.");
    applyMode("iframe");
  }
});

btnRemoteShot?.addEventListener("click", async () => {
  try {
    if (!remoteReady) await remoteStart();
    await remoteShot();
  } catch (e) {
    logTask("⚠ Remote screenshot falló: " + (e?.message || "error"));
  }
});

btnRemoteGoto?.addEventListener("click", async () => {
  const url = (remoteUrlInput?.value || "").trim();
  if (!url) return;
  try {
    if (!remoteReady) await remoteStart();
    await remoteGoto(url);
    logTask("🌐 Remote goto: " + url);
  } catch (e) {
    logTask("⚠ Remote goto falló: " + (e?.message || "error"));
  }
});

btnRemoteType?.addEventListener("click", async () => {
  const txt = (remoteTypeInput?.value || "");
  if (!txt) return;
  try {
    if (!remoteReady) await remoteStart();
    await remoteType(txt);
    logTask("⌨ Texto enviado.");
  } catch (e) {
    logTask("⚠ Remote type falló: " + (e?.message || "error"));
  }
});

btnKeyEnter?.addEventListener("click", async () => {
  try { if (!remoteReady) await remoteStart(); await remoteKey("Enter"); } catch (e){ logTask("⚠ " + e.message); }
});
btnKeyBackspace?.addEventListener("click", async () => {
  try { if (!remoteReady) await remoteStart(); await remoteKey("Backspace"); } catch (e){ logTask("⚠ " + e.message); }
});
btnKeyTab?.addEventListener("click", async () => {
  try { if (!remoteReady) await remoteStart(); await remoteKey("Tab"); } catch (e){ logTask("⚠ " + e.message); }
});
btnKeyEsc?.addEventListener("click", async () => {
  try { if (!remoteReady) await remoteStart(); await remoteKey("Escape"); } catch (e){ logTask("⚠ " + e.message); }
});
btnKeyCtrlL?.addEventListener("click", async () => {
  try { if (!remoteReady) await remoteStart(); await remoteKey("Control+L"); } catch (e){ logTask("⚠ " + e.message); }
});

// Click en screenshot => click real
remoteScreen?.addEventListener("click", async (e) => {
  if (!remoteReady) {
    logTask("⚠ Remote no iniciado. Presiona 🟢 Iniciar.");
    return;
  }

  const rect = remoteScreen.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const x = (e.clientX - rect.left) * (RemoteViewport.width / rect.width);
  const y = (e.clientY - rect.top) * (RemoteViewport.height / rect.height);

  logTask(`🖱 Click: (${Math.round(x)}, ${Math.round(y)})`);
  try {
    await remoteClick(x, y);
  } catch (err) {
    logTask("⚠ Remote click falló: " + (err?.message || "error"));
  }
});

// ==============================
// Initial greeting
// ==============================
applyMode(uiMode);
setNet(true, "Online ✅");
setState(AgentState.IDLE, "Lista para trabajar.");
addMessage("Hola, soy <strong>MIRA</strong>. Estoy lista para trabajar contigo en modo copiloto web. 👋", "mira");
speak("Hola, soy MIRA. Estoy lista para trabajar contigo en modo copiloto web.");
