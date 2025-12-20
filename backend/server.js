import express from "express";
import cors from "cors";
import OpenAI from "openai";

// ✅ Cambiamos a puppeteer-core + chromium portable (Render-friendly)
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ✅ Puedes restringir a tu GitHub Pages más adelante.
// Por ahora dejamos abierto para no bloquear pruebas.
app.use(cors());

// --------------------
// Fetch seguro (por si Node no trae fetch en tu runtime de Render)
// --------------------
let _fetch = globalThis.fetch;
async function safeFetch(...args) {
  if (!_fetch) {
    const mod = await import("node-fetch");
    _fetch = mod.default;
  }
  return _fetch(...args);
}

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Memoria reciente en RAM (por sessionId)
const sessions = new Map();
const MAX_TURNS = 18;

// --- Utils ---
function getSession(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

function pushMsg(session, role, content, name) {
  const msg = name ? { role, name, content } : { role, content };
  session.push(msg);
  const maxMsgs = MAX_TURNS * 2;
  if (session.length > maxMsgs) session.splice(0, session.length - maxMsgs);
}

function isTaskLike(text) {
  const t = (text || "").toLowerCase();
  const verbs = [
    "abre", "abrir",
    "busca", "buscar",
    "rellena", "rellenar",
    "completa", "completar",
    "descarga", "descargar",
    "sube", "subir",
    "publica", "publicar",
    "crea", "crear",
    "pon", "reproduce", "reproducir"
  ];
  return verbs.some(v => t.includes(v));
}

function stripHtmlToText(html) {
  if (!html) return "";
  // remove scripts/styles
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // remove tags
  s = s.replace(/<\/?[^>]+(>|$)/g, " ");
  // decode basic entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  // collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// --------------------
// Tools v1 (server-side)
// --------------------
const toolLog = new Map();   // sessionId -> array logs
const planStore = new Map(); // sessionId -> plan object

// ✅ acciones para el frontend (copiloto)
const actionStore = new Map(); // sessionId -> actions[]
function pushAction(sessionId, action) {
  if (!actionStore.has(sessionId)) actionStore.set(sessionId, []);
  actionStore.get(sessionId).push(action);
}

function pushToolLog(sessionId, line) {
  if (!toolLog.has(sessionId)) toolLog.set(sessionId, []);
  toolLog.get(sessionId).push(line);
}

const tools = [
  {
    type: "function",
    function: {
      name: "set_plan",
      description:
        "Guarda un plan corto de 2 a 6 pasos para una tarea del usuario. Úsalo cuando detectes que el usuario pidió una acción/tarea.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "Objetivo en una frase." },
          steps: {
            type: "array",
            description: "Lista de pasos (2 a 6).",
            items: { type: "string" },
            minItems: 2,
            maxItems: 6
          },
          needs_user: {
            type: "array",
            description: "Cosas que necesitas del usuario (si aplica).",
            items: { type: "string" }
          },
          confirm_required: {
            type: "boolean",
            description: "True si requiere confirmación explícita (enviar/pagar/borrar/publicar/login)."
          }
        },
        required: ["goal", "steps", "confirm_required"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Descarga el contenido HTML de una URL pública y devuelve texto extraído. Úsalo si necesitas leer una página para responder o verificar información.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL http(s) a consultar." },
          max_chars: { type: "integer", description: "Máximo de caracteres de texto a devolver.", default: 12000 }
        },
        required: ["url"]
      }
    }
  },
  // ✅ tool copiloto (abrir URL en el frontend)
  {
    type: "function",
    function: {
      name: "open_url",
      description:
        "Solicita abrir una URL en la ventana de tareas del frontend (modo copiloto). Úsala cuando el usuario diga 'abre X' o necesites mostrar una web.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL http(s) a abrir." }
        },
        required: ["url"]
      }
    }
  }
];

// Ejecutores
async function runTool(sessionId, toolCall) {
  const { name, arguments: argsJson } = toolCall.function;
  const args = argsJson ? JSON.parse(argsJson) : {};

  if (name === "set_plan") {
    const plan = {
      goal: args.goal,
      steps: args.steps,
      needs_user: args.needs_user || [],
      confirm_required: !!args.confirm_required
    };
    planStore.set(sessionId, plan);
    pushToolLog(sessionId, `🧠 PLAN creado: ${plan.goal}`);
    plan.steps.forEach((s, i) => pushToolLog(sessionId, `  ${i + 1}. ${s}`));
    if (plan.confirm_required) pushToolLog(sessionId, "🔒 Requiere confirmación del usuario.");
    if (plan.needs_user?.length) pushToolLog(sessionId, `🙋 Necesito del usuario: ${plan.needs_user.join(" | ")}`);

    return { ok: true, stored: true };
  }

  if (name === "web_fetch") {
    const url = args.url;
    const maxChars = Number.isFinite(args.max_chars) ? args.max_chars : 12000;

    pushToolLog(sessionId, `🌐 web_fetch: ${url}`);

    const resp = await safeFetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "MIRA-Agent/1.0 (+https://innova-space-edu.github.io/mira-agent/)"
      }
    });

    const contentType = resp.headers.get("content-type") || "";
    const status = resp.status;

    const raw = await resp.text();
    const text = stripHtmlToText(raw);
    const clipped = text.slice(0, maxChars);

    pushToolLog(sessionId, `✅ web_fetch status ${status} (${contentType.split(";")[0] || "unknown"})`);
    pushToolLog(sessionId, `📄 Texto extraído: ${Math.min(clipped.length, maxChars)} chars`);

    return {
      url,
      status,
      contentType,
      text: clipped
    };
  }

  // ✅ open_url (solo genera acción para el frontend)
  if (name === "open_url") {
    const url = args.url;
    pushToolLog(sessionId, `🪟 Abrir URL solicitada: ${url}`);
    pushAction(sessionId, { type: "open_url", url });
    return { ok: true };
  }

  // Tool desconocida
  pushToolLog(sessionId, `⚠ Tool desconocida: ${name}`);
  return { error: "Unknown tool" };
}

// --------------------
// Puppeteer Browser Manager (Control real)
// --------------------
const browserSessions = new Map();
// sessionId -> { browser, page, viewport, lastShotBase64, lastUrl }

function browserDisabled() {
  // ✅ opción para apagar navegador en Render si quieres estabilidad
  return String(process.env.DISABLE_BROWSER || "").trim() === "1";
}

async function getOrCreateBrowser(sessionId) {
  if (browserDisabled()) {
    const err = new Error("Browser deshabilitado por DISABLE_BROWSER=1");
    err.code = "BROWSER_DISABLED";
    throw err;
  }

  if (browserSessions.has(sessionId)) return browserSessions.get(sessionId);

  const viewport = { width: 1280, height: 720 };

  // ✅ 1) Si hay browser remoto: usa websocket
  if (process.env.BROWSER_WS) {
    const browser = await puppeteer.connect({
      browserWSEndpoint: process.env.BROWSER_WS,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
    );
    page.setDefaultNavigationTimeout(45000);
    page.setDefaultTimeout(30000);

    const obj = { browser, page, viewport, lastShotBase64: "", lastUrl: "" };
    browserSessions.set(sessionId, obj);
    return obj;
  }

  // ✅ 2) Browser local: usa chromium portable o executablePath si lo defines
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    (await chromium.executablePath());

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: viewport,
  });

  const page = await browser.newPage();

  // User agent “normal” (menos bloqueos básicos)
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
  );

  // Timeouts razonables
  page.setDefaultNavigationTimeout(45000);
  page.setDefaultTimeout(30000);

  const obj = {
    browser,
    page,
    viewport,
    lastShotBase64: "",
    lastUrl: "",
  };

  browserSessions.set(sessionId, obj);
  return obj;
}

async function safeScreenshot(sessionId) {
  const s = await getOrCreateBrowser(sessionId);
  const buf = await s.page.screenshot({ type: "png" });
  const b64 = buf.toString("base64");
  s.lastShotBase64 = b64;
  return b64;
}

async function closeBrowserSession(sessionId) {
  const s = browserSessions.get(sessionId);
  if (!s) return;
  try { await s.page?.close(); } catch {}
  try { await s.browser?.close(); } catch {}
  browserSessions.delete(sessionId);
}

// --------------------
// System prompt (Agente PRO)
// --------------------
const SYSTEM_PROMPT = `
Eres MIRA (Modular Intelligent Responsive Assistant), un AGENTE IA profesional.

ESTILO:
- Responde siempre en español latino, natural, directo y claro.
- Si es conversación normal: responde breve pero útil.
- Si el usuario pide una TAREA (acciones en web/proceso): actúa como agente.

MODO AGENTE (OBLIGATORIO cuando detectes tarea):
1) Llama a la tool set_plan con:
   - goal (1 frase)
   - steps (2 a 6 pasos)
   - confirm_required (true si enviar/pagar/borrar/publicar/login)
   - needs_user (si necesitas que el usuario haga algo)
2) Si el usuario pidió "abrir" un sitio, o necesitas mostrar una web:
   - Llama a open_url con la URL correspondiente (ej: https://www.youtube.com).
3) Después de set_plan/open_url:
   - Si necesitas leer una URL para responder/validar, usa web_fetch(url).
   - Luego responde al usuario con:
     - ✅ Objetivo
     - 🧭 Plan (pasos)
     - 🔒 Si requiere confirmación, pide confirmación antes de continuar.

SEGURIDAD:
- Nunca pidas ni almacenes contraseñas.
- Si hay login, dile al usuario que lo ingrese él.
- Para acciones delicadas: pide confirmación explícita.

IMPORTANTE:
- Usa tools cuando sea útil.
- No inventes contenido de páginas: si no lo sabes, pide URL o usa web_fetch.
`;

// --------------------
// Basic routes
// --------------------
app.get("/", (_, res) => res.send("MIRA backend (Groq + Planner + Tools + Copilot + Puppeteer) OK ✅"));

// --------------------
// Browser API (Real control)
// --------------------
app.post("/api/browser/start", async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "Falta sessionId" });

    const s = await getOrCreateBrowser(sessionId);
    const shot = await safeScreenshot(sessionId);

    res.json({ ok: true, viewport: s.viewport, screenshotBase64: shot });
  } catch (e) {
    console.error("browser/start", e);

    // ✅ En vez de 500 duro, devolvemos ok:false con razón
    const reason =
      e?.code === "BROWSER_DISABLED"
        ? "Browser deshabilitado (DISABLE_BROWSER=1)"
        : (e?.message || "Error iniciando navegador");

    res.status(200).json({ ok: false, error: reason, hint: "Usa modo Iframe o configura BROWSER_WS / Chromium." });
  }
});

app.post("/api/browser/goto", async (req, res) => {
  try {
    const { sessionId, url } = req.body || {};
    if (!sessionId || !url) return res.status(400).json({ error: "Falta sessionId o url" });

    const s = await getOrCreateBrowser(sessionId);

    await s.page.goto(url, { waitUntil: "domcontentloaded" });
    s.lastUrl = url;

    const shot = await safeScreenshot(sessionId);
    res.json({ ok: true, screenshotBase64: shot });
  } catch (e) {
    console.error("browser/goto", e);
    res.status(200).json({ ok: false, error: e?.message || "Error navegando" });
  }
});

app.get("/api/browser/screenshot", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).json({ error: "Falta sessionId" });

    const shot = await safeScreenshot(sessionId);
    res.json({ ok: true, screenshotBase64: shot });
  } catch (e) {
    console.error("browser/screenshot", e);
    res.status(200).json({ ok: false, error: e?.message || "Error screenshot" });
  }
});

app.post("/api/browser/click", async (req, res) => {
  try {
    const { sessionId, x, y } = req.body || {};
    if (!sessionId || x == null || y == null) return res.status(400).json({ error: "Falta sessionId/x/y" });

    const s = await getOrCreateBrowser(sessionId);
    await s.page.mouse.click(Number(x), Number(y), { delay: 10 });

    const shot = await safeScreenshot(sessionId);
    res.json({ ok: true, screenshotBase64: shot });
  } catch (e) {
    console.error("browser/click", e);
    res.status(200).json({ ok: false, error: e?.message || "Error click" });
  }
});

app.post("/api/browser/type", async (req, res) => {
  try {
    const { sessionId, text } = req.body || {};
    if (!sessionId || text == null) return res.status(400).json({ error: "Falta sessionId/text" });

    const s = await getOrCreateBrowser(sessionId);
    await s.page.keyboard.type(String(text), { delay: 12 });

    const shot = await safeScreenshot(sessionId);
    res.json({ ok: true, screenshotBase64: shot });
  } catch (e) {
    console.error("browser/type", e);
    res.status(200).json({ ok: false, error: e?.message || "Error type" });
  }
});

app.post("/api/browser/key", async (req, res) => {
  try {
    const { sessionId, key } = req.body || {};
    if (!sessionId || !key) return res.status(400).json({ error: "Falta sessionId/key" });

    const s = await getOrCreateBrowser(sessionId);
    await s.page.keyboard.press(String(key));

    const shot = await safeScreenshot(sessionId);
    res.json({ ok: true, screenshotBase64: shot });
  } catch (e) {
    console.error("browser/key", e);
    res.status(200).json({ ok: false, error: e?.message || "Error key" });
  }
});

app.post("/api/browser/stop", async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "Falta sessionId" });

    await closeBrowserSession(sessionId);
    res.json({ ok: true });
  } catch (e) {
    console.error("browser/stop", e);
    res.status(500).json({ error: "Error stop" });
  }
});

// --------------------
// Chat API (Groq + tools + actions)
// --------------------
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, userText } = req.body || {};
    if (!sessionId || !userText) {
      return res.status(400).json({ error: "Falta sessionId o userText" });
    }

    // limpia logs/plan/acciones por turno
    toolLog.set(sessionId, []);
    planStore.delete(sessionId);
    actionStore.set(sessionId, []);

    const session = getSession(sessionId);
    pushMsg(session, "user", userText);

    const wantAgent = isTaskLike(userText);

    let messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...session
    ];

    let finalText = "";
    let agentState = wantAgent ? "PLANNING" : "IDLE";

    for (let i = 0; i < 4; i++) {
      const resp = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.6
      });

      const msg = resp.choices?.[0]?.message;

      if (msg?.tool_calls?.length) {
        agentState = "EXECUTING";

        messages.push({
          role: "assistant",
          content: msg.content || "",
          tool_calls: msg.tool_calls
        });

        for (const tc of msg.tool_calls) {
          const toolResult = await runTool(sessionId, tc);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify(toolResult)
          });
        }

        agentState = "OBSERVING";
        continue;
      }

      finalText = msg?.content?.trim() || "No pude generar respuesta.";
      break;
    }

    pushMsg(session, "assistant", finalText);

    const plan = planStore.get(sessionId) || null;
    const logs = toolLog.get(sessionId) || [];
    const actions = actionStore.get(sessionId) || [];

    res.json({
      assistantText: finalText,
      agent: {
        state: plan ? "PLANNING" : (wantAgent ? agentState : "IDLE"),
        plan,
        logs
      },
      actions
    });

  } catch (err) {
    console.error("ERROR /api/chat:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("MIRA backend (Groq) escuchando en", PORT));
