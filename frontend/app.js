// ==============================
// MIRA Agent Web (Paso 2 - Cloud Brain via Groq backend)
// - Chat UI
// - Task window
// - Agent states
// - Voice (WebSpeech)
// - Backend connection (Render) ✅
// ==============================

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

// ✅ Tu backend Render
const BACKEND_URL = "https://mira-agent.onrender.com";

// ---- Session (memoria por sesión en backend) ----
const sessionId = localStorage.getItem("mira_session_id") || crypto.randomUUID();
localStorage.setItem("mira_session_id", sessionId);

// ---- Voice ----
let voiceEnabled = true;

// ---- Agent states ----
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

// ============ UI Helpers ============
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

// ===== Typing indicator =====
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

// ============ Voice (WebSpeech) ============
function stripDoNotRead(text) {
  // Quita bloques de código, inline code y LaTeX simple para que no lo lea en voz
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

  // Cancela lo anterior para evitar “dos voces”
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "es-CL";
  u.rate = 1.02;

  window.speechSynthesis.speak(u);
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  toggleVoiceBtn.textContent = voiceEnabled ? "🔊 Voz" : "🔇 Voz";
  addMessage(voiceEnabled ? "Voz activada." : "Voz desactivada.", "mira");
  speak(voiceEnabled ? "Voz activada." : "Voz desactivada.");
}

// ============ Agent heuristics ============
function looksLikeTask(userText) {
  const t = userText.toLowerCase();
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

// ============ Backend ============
async function callBackend(userText) {
  const r = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, userText }),
  });

  if (!r.ok) {
    let msg = "Backend error";
    try {
      const data = await r.json();
      msg = data?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return await r.json(); // { assistantText, model? }
}

// ============ Main send ============
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage(text, "user");
  inputEl.value = "";

  // Estado UI
  setState(AgentState.IDLE, "Conversando…");
  showTyping(true);

  // Si parece tarea, abrimos panel y registramos intención
  if (looksLikeTask(text)) {
    openTaskWindow();
    setState(AgentState.PLANNING, "Analizando tarea…");
    logTask("📌 Detecté una posible tarea accionable.");
    logTask("🔒 Si aparece login, tú ingresas credenciales manualmente.");
  }

  try {
    const data = await callBackend(text);
    showTyping(false);

    const reply = data.assistantText || "No pude responder.";
    addMessage(reply, "mira");
    speak(reply);

    // Si la conversación deriva en tarea, mantenemos el panel listo
    if (looksLikeTask(text)) {
      setState(AgentState.WAITING_USER, "Lista para comenzar (modo web).");
      logTask("✅ Respuesta del cerebro cloud recibida.");
      logTask("🧠 Próximo: agregamos herramientas reales para ejecutar acciones web.");
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
    logTask("⚠ Error conectando al backend: " + (e?.message || "desconocido"));
  }
}

// ============ Events ============
sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

newChatBtn.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  taskLogEl.innerHTML = "";
  setState(AgentState.IDLE, "Lista para trabajar.");
  addMessage("Hola, soy MIRA. Ya tengo cerebro cloud conectado. Dime qué hacemos.", "mira");
  speak("Hola, soy MIRA. Ya tengo cerebro cloud conectado. Dime qué hacemos.");
});

openTaskBtn.addEventListener("click", () => openTaskWindow());
closeTaskBtn.addEventListener("click", () => closeTaskWindow());
toggleVoiceBtn.addEventListener("click", toggleVoice);

pauseBtn.addEventListener("click", () => {
  logTask("⏸ Pausa solicitada por el usuario.");
  setState(AgentState.WAITING_USER, "Pausada. Puedes continuar cuando quieras.");
});

resumeBtn.addEventListener("click", () => {
  logTask("▶ Continuar solicitado por el usuario.");
  setState(AgentState.EXECUTING, "Reanudando…");
  setTimeout(() => setState(AgentState.OBSERVING, "Verificando resultados…"), 600);
  setTimeout(() => setState(AgentState.DONE, "Listo. (Modo conversación + backend OK)"), 1200);
});

takeOverBtn.addEventListener("click", () => {
  logTask("🧑‍✈️ El usuario tomó el control (modo seguro).");
  setState(AgentState.WAITING_USER, "Tú tienes el control. Yo te guío.");
  addMessage("Perfecto. Tú tomas el control. Dime qué ves en pantalla y te guío paso a paso.", "mira");
  speak("Perfecto. Tú tomas el control. Te guío paso a paso.");
});

// ============ Initial greeting ============
setState(AgentState.IDLE, "Lista para trabajar.");
addMessage("Hola, soy <strong>MIRA</strong>. Ya tengo <u>cerebro cloud</u> conectado. 👋", "mira");
speak("Hola, soy MIRA. Ya tengo cerebro cloud conectado.");
