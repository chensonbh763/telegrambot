require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ✅ Rota principal para checagem
app.get("/", (req, res) => {
  res.send("🚀 API LucreMaisTask está no ar!");
});

// 🔹 Listar tarefas ativas
app.get("/api/tarefas", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM tarefas WHERE ativa = true ORDER BY id DESC"
    );
    res.json(rows);
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error);
    res.status(500).json({ erro: "Erro ao listar tarefas" });
  }
});

// 🔹 Criar nova tarefa (via painel admin)
app.post("/admin/tarefa", async (req, res) => {
  const { titulo, link, dia, pontos } = req.body;
  try {
    await pool.query(
      "INSERT INTO tarefas (titulo, link, dia, pontos, ativa) VALUES ($1, $2, $3, $4, true)",
      [titulo, link, dia, pontos]
    );
    res.send("✅ Tarefa criada com sucesso!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao criar tarefa.");
  }
});

// 🔹 Executar comandos SQL manuais (via painel admin)
app.post("/admin/sql", async (req, res) => {
  const { sql } = req.body;
  try {
    const { rows } = await pool.query(sql);
    res.send(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
    res.status(400).send("Erro SQL: " + err.message);
  }
});

// 🔹 Telegram Bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMaisTask!\nClique no botão abaixo para acessar as tarefas do dia e começar a lucrar. 💸", {
    reply_markup: {
      inline_keyboard: [[
        {
          text: "📲 Acessar Mini App",
          web_app: { url: "https://web-production-10f9d.up.railway.app" }
        }
      ]]
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ API e Bot rodando na porta ${PORT}`);
});
