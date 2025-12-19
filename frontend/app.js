// ==============================
// MIRA Agent Web (Base)
// - Chat UI
// - Task window
// - Agent states (stub)
// - Voice toggle (stub; Paso 2 lo vuelve real)
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

// ---- Agent session memory (v1: session only) ----
let chatHistory = []; // [{role:'user'|'assistant', content:'...'}]
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
  // Básico para evitar HTML inyectado
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ============ Voice (stub) ============
function speak(text) {
  if (!voiceEnabled) return;
  // Paso 2: aquí conectamos un TTS real (cloud o WebSpeech)
  // Por ahora dejamos el "hook" listo.
  // console.log("[VOICE]", text);
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  toggleVoiceBtn.textContent = voiceEnabled ? "🔊 Voz" : "🔇 Voz";
  addMessage(voiceEnabled ? "Voz activada." : "Voz desactivada.", "mira");
}

// ============ Agent stub logic ============
function looksLikeTask(userText) {
  const t = userText.toLowerCase();
  const verbs = ["abre", "buscar", "busca", "rellena", "completa", "envía", "manda", "descarga", "sube", "publica", "crea"];
  return verbs.some(v => t.includes(v));
}

function agentRespond(userText) {
  // Paso 2: aquí se conecta el cerebro cloud (modelo IA).
  // Por ahora: comportamiento mínimo y controlado.
  if (looksLikeTask(userText)) {
    openTaskWindow();
    setState(AgentState.PLANNING, "Armando un plan corto…");
    logTask("📌 Entendí que es una tarea accionable.");
    logTask("🧩 (Stub) En el Paso 2 esto se reemplaza por el plan real del modelo IA.");
    setTimeout(() => {
      setState(AgentState.WAITING_USER, "Lista para comenzar cuando confirmes.");
      logTask("✅ Plan de ejemplo: 1) Abrir sitio 2) Buscar 3) Resumir");
      logTask("🔒 Si aparece login, tú ingresas las credenciales.");
      addMessage("Entendido. Puedo ejecutar esa tarea en la web. En el Paso 2, mi cerebro cloud planificará y actuará de verdad. ¿Quieres que lo haga ahora (cuando tengamos el cerebro conectado)?", "mira");
      speak("Entendido. ¿Quieres que lo haga ahora?");
    }, 700);
  } else {
    setState(AgentState.IDLE, "Conversando…");
    addMessage("Te entiendo. Por ahora soy la base web de MIRA. En el Paso 2 voy a responder como un agente real con cerebro cloud.", "mira");
    speak("Te entiendo. En el paso dos responderé como un agente real con cerebro cloud.");
  }
}

// ============ Events ============
function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage(text, "user");
  chatHistory.push({ role: "user", content: text });

  inputEl.value = "";

  // Simulación de “thinking…”
  setTimeout(() => {
    agentRespond(text);
  }, 350);
}

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

newChatBtn.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  taskLogEl.innerHTML = "";
  chatHistory = [];
  setState(AgentState.IDLE, "Lista para trabajar.");
  addMessage("Hola, soy MIRA. Dime qué quieres hacer hoy.", "mira");
  speak("Hola, soy MIRA. Dime qué quieres hacer hoy.");
});

openTaskBtn.addEventListener("click", () => {
  openTaskWindow();
});

closeTaskBtn.addEventListener("click", () => {
  closeTaskWindow();
});

toggleVoiceBtn.addEventListener("click", toggleVoice);

pauseBtn.addEventListener("click", () => {
  logTask("⏸ Pausa solicitada por el usuario.");
  setState(AgentState.WAITING_USER, "Pausada. Puedes continuar cuando quieras.");
});

resumeBtn.addEventListener("click", () => {
  logTask("▶ Continuar solicitado por el usuario.");
  setState(AgentState.EXECUTING, "Reanudando…");
  setTimeout(() => setState(AgentState.OBSERVING, "Verificando resultados…"), 600);
  setTimeout(() => setState(AgentState.DONE, "Tarea lista (stub)."), 1200);
});

takeOverBtn.addEventListener("click", () => {
  logTask("🧑‍✈️ El usuario tomó el control (modo seguro).");
  setState(AgentState.WAITING_USER, "Tú tienes el control. Yo te guío.");
  addMessage("Perfecto. Tú tomas el control. Dime qué ves en pantalla y te guío paso a paso.", "mira");
  speak("Perfecto. Tú tomas el control. Te guío paso a paso.");
});

// Initial greeting
setState(AgentState.IDLE, "Lista para trabajar.");
addMessage("Hola, soy <strong>MIRA</strong>. Puedo conversar contigo y ejecutar tareas en la web en modo seguro. 👋", "mira");
speak("Hola, soy MIRA. Estoy lista para trabajar contigo.");

