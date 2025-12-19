import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ✅ Puedes restringir a tu GitHub Pages más adelante.
// Por ahora dejamos abierto para no bloquear pruebas.
app.use(cors());

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
  const verbs = ["abre", "abrir", "busca", "buscar", "rellena", "rellenar", "completa", "completar", "descarga", "descargar", "sube", "subir", "publica", "publicar", "crea", "crear"];
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
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// --------------------
// Tools v1 (server-side)
// --------------------
const toolLog = new Map(); // sessionId -> array logs
const planStore = new Map(); // sessionId -> plan object

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

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "MIRA-Agent/1.0 (+https://innova-space-edu.github.io/mira-agent/)"
      }
    });

    const contentType = resp.headers.get("content-type") || "";
    const status = resp.status;

    // Solo procesamos texto/html o texto plano
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

  // Tool desconocida
  pushToolLog(sessionId, `⚠ Tool desconocida: ${name}`);
  return { error: "Unknown tool" };
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
2) Después de set_plan:
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

app.get("/", (_, res) => res.send("MIRA backend (Groq + Planner + Tools) OK ✅"));

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, userText } = req.body || {};
    if (!sessionId || !userText) {
      return res.status(400).json({ error: "Falta sessionId o userText" });
    }

    // limpia logs/plan por turno (para enviar al frontend solo lo relevante)
    toolLog.set(sessionId, []);
    planStore.delete(sessionId);

    const session = getSession(sessionId);
    pushMsg(session, "user", userText);

    const wantAgent = isTaskLike(userText);

    // Loop agentic: modelo -> tool calls -> modelo (máx 4 rondas)
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

      // Si el modelo llama herramientas
      if (msg?.tool_calls?.length) {
        agentState = "EXECUTING";

        // Añadimos el mensaje del assistant con tool_calls
        messages.push({
          role: "assistant",
          content: msg.content || "",
          tool_calls: msg.tool_calls
        });

        // Ejecutamos cada tool call
        for (const tc of msg.tool_calls) {
          const toolResult = await runTool(sessionId, tc);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify(toolResult)
          });
        }

        // continuar loop para que el modelo “observe” resultados
        agentState = "OBSERVING";
        continue;
      }

      // Sin tool calls: mensaje final
      finalText = msg?.content?.trim() || "No pude generar respuesta.";
      break;
    }

    // Guarda respuesta final en memoria de sesión
    pushMsg(session, "assistant", finalText);

    const plan = planStore.get(sessionId) || null;
    const logs = toolLog.get(sessionId) || [];

    res.json({
      assistantText: finalText,
      agent: {
        state: plan ? "PLANNING" : (wantAgent ? agentState : "IDLE"),
        plan,
        logs
      }
    });

  } catch (err) {
    console.error("ERROR /api/chat:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("MIRA backend (Groq) escuchando en", PORT));
s
