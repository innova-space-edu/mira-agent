import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ✅ CORS: permite tu GitHub Pages. (En producción lo puedes restringir más)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Memoria reciente por sesión (en RAM). Más adelante: DB/Redis.
const sessions = new Map();
const MAX_TURNS = 18;

// Prompt del “cerebro” MIRA (base conversacional + seguridad)
const SYSTEM_PROMPT = `
Eres MIRA (Modular Intelligent Responsive Assistant), un agente conversacional profesional.
Hablas siempre en español latino, natural y claro.
Mantén coherencia con el contexto reciente.
Nunca pidas contraseñas ni datos sensibles. Si aparece login, el usuario ingresa sus credenciales manualmente.
Si el usuario pide acciones delicadas (enviar/pagar/borrar/publicar), pide confirmación explícita.
Responde sin relleno, útil, ordenado y amable.
`;

function getSession(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

function pushMsg(session, role, content) {
  session.push({ role, content });
  // recorta
  const maxMsgs = MAX_TURNS * 2;
  if (session.length > maxMsgs) session.splice(0, session.length - maxMsgs);
}

app.get("/", (_, res) => res.send("MIRA backend OK ✅"));

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, userText } = req.body || {};
    if (!sessionId || !userText) {
      return res.status(400).json({ error: "Falta sessionId o userText" });
    }

    const session = getSession(sessionId);
    pushMsg(session, "user", userText);

    // ✅ Chat Completions (estable y simple para arrancar)
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...session.map(m => ({ role: m.role, content: m.content }))
      ]
    });

    const assistantText = response.choices?.[0]?.message?.content?.trim() || "No pude generar respuesta.";
    pushMsg(session, "assistant", assistantText);

    res.json({ assistantText });
  } catch (err) {
    console.error("ERROR /api/chat:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("MIRA backend escuchando en", PORT));
