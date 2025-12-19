// ==============================
// MIRA Agent Web (Planner + Tools Ready)
// - Chat UI
// - Task window (logs/plan)
// - Agent states
// - Voice (WebSpeech)
// - Backend connection (Render) ✅
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

const agentStateEl = document.getElementById("agentState");
const agentHintEl = document.getElementById("agentHint");

const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const takeOverBtn = document.getElementById("takeOverBtn");

// ✅ Backend Render
const BACKEND_URL = "https://mira-agent.onrender.com";

// ------- Session (memoria reciente en backend por sessionId) -------
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
    .replace(/```[\s\S]*?```/g, "")      // code blocks
    .replace(/`[^`]*`/g, "")            // inline code
    .replace(/\$\$[\s\S]*?\$\$/g, "")   // latex blocks
    .replace(/\$[^$]*\$/g, "")          // latex inline
    .replace(/\{\{[\s\S]*?\}\}/g, "")   // templates
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
// Agent heuristics (frontend hint)
// ==============================
function looksLikeTask(userText) {
  const t = (userText || "").toLowerCase();
  const verbs = [
    "abre", "abrir",
    "buscar", "busca",
    "rellena", "rellenar",
    "completa", "completar",
    "envía", "enviar",
    "manda", "mandar",
    "descarga", "descargar",
    "sube", "subir",
    "publica", "publicar",
    "crea", "crear"
  ];
  return verbs.some(v => t.includes(v));
}

// ==============================
// Backend
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

  return data; // { assistantText, agent? }
}

// ==============================
// Render Agent Plan + Logs (from backend)
// ==============================
function renderAgent(agent) {
  if (!agent) return;

  // Abrir panel si hay algo que mostrar
  const hasPlan = !!agent.plan;
  const hasLogs = Array.isArray(agent.logs) && agent.logs.length > 0;

  if (hasPlan || hasLogs) openTaskWindow();

  // Estado
  if (agent.state && AgentState[agent.state]) {
    setState(agent.state, "Procesando…");
  }

  // Mostrar plan (si existe)
  if (hasPlan) {
    clearTaskLog();
    logTask(`🧠 Objetivo: ${agent.plan.goal}`);

    (agent.plan.steps || []).forEach((s, i) => {
      logTask(`${i + 1}. ${s}`);
    });

    if (agent.plan.needs_user?.length) {
      logTask(`🙋 Necesito de ti: ${agent.plan.needs_user.join(" | ")}`);
    }

    if (agent.plan.confirm_required) {
      logTask("🔒 Requiere confirmación explícita antes de continuar.");
    }
  }

  // Logs de tools (si existen)
  if (hasLogs) {
    agent.logs.forEach(line => logTask(line));
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

  // UI 상태
  setState(AgentState.IDLE, "Conversando…");
  showTyping(true);

  // Hint inicial (solo UI)
  if (looksLikeTask(text)) {
    openTaskWindow();
    setState(AgentState.PLANNING, "Analizando tarea…");
    logTask("📌 Detecté una posible tarea accionable.");
    logTask("🔒 Si aparece login, tú ingresas credenciales manualmente.");
  }

  try {
    const data = await callBackend(text);
    showTyping(false);

    // Planner + Tools info (si backend lo envía)
    renderAgent(data.agent);

    // Respuesta
    const reply = data.assistantText || "No pude responder.";
    addMessage(reply, "mira");
    speak(reply);

    // Estado final
    if (data.agent?.plan?.confirm_required) {
      setState(AgentState.WAITING_USER, "Esperando tu confirmación…");
    } else {
      setState(AgentState.IDLE, "Lista para trabajar.");
    }

  } catch (e) {
    showTyping(false);
    setState(AgentState.RECOVERING, "Problema de conexión.");
    addMessage(
      "Tuve un problema conectando con el servidor. Revisa que el backend esté activo en Render y que la URL sea correcta.",
      "mira"
    );
    logTask("⚠ Error: " + (e?.message || "desconocido"));
  }
}

// ==============================
// Events
// ==============================
sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

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
  setTimeout(() => setState(AgentState.OBSERVING, "Verificando resultados…"), 600);
  setTimeout(() => setState(AgentState.DONE, "Listo."), 1200);
});

takeOverBtn.addEventListener("click", () => {
  logTask("🧑‍✈️ El usuario tomó el control (modo seguro).");
  setState(AgentState.WAITING_USER, "Tú tienes el control. Yo te guío.");
  addMessage("Perfecto. Tú tomas el control. Dime qué ves en pantalla y te guío paso a paso.", "mira");
  speak("Perfecto. Tú tomas el control. Te guío paso a paso.");
});

// ==============================
// Initial greeting
// ==============================
setState(AgentState.IDLE, "Lista para trabajar.");
addMessage("Hola, soy <strong>MIRA</strong>. Ya tengo <u>cerebro cloud</u> conectado. 👋", "mira");
speak("Hola, soy MIRA. Ya tengo cerebro cloud conectado.");
