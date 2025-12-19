import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Para empezar simple: permitir cualquier origen.
// Luego lo restringimos a tu GitHub Pages.
app.use(cors());

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// Memoria reciente por sesión (RAM)
const sessions = new Map();
const MAX_TURNS = 18;

const SYSTEM_PROMPT = `
Eres MIRA (Modular Intelligent Responsive Assistant), un agente conversacional profesional.
Hablas siempre en español latino, natural y claro.
Mantén coherencia con el contexto reciente.

SEGURIDAD:
- Nunca pidas ni almacenes contraseñas.
- Si aparece login, el usuario ingresa credenciales manualmente.
- Para acciones delicadas (enviar/pagar/borrar/publicar), pide confirmación explícita.

Cuando el usuario pida una tarea web:
- Propon un plan corto (2–6 pasos).
- Di qué necesitas del usuario (si aplica).
- Confirma antes de ejecutar acciones delicadas.
`;

function getSession(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

function pushMsg(session, role, content) {
  session.push({ role, content });
  const maxMsgs = MAX_TURNS * 2;
  if (session.length > maxMsgs) session.splice(0, session.length - maxMsgs);
}

app.get("/", (_, res) => res.send("MIRA backend (Groq) OK ✅"));

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, userText } = req.body || {};
    if (!sessionId || !userText) {
      return res.status(400).json({ error: "Falta sessionId o userText" });
    }

    const session = getSession(sessionId);
    pushMsg(session, "user", userText);

    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    // Chat Completions (OpenAI-compatible en Groq)
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...session.map(m => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.6
    });

    const assistantText =
      response.choices?.[0]?.message?.content?.trim() ||
      "No pude generar respuesta.";

    pushMsg(session, "assistant", assistantText);

    res.json({ assistantText, model });
  } catch (err) {
    console.error("ERROR /api/chat:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("MIRA backend (Groq) escuchando en", PORT));
