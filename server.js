require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Necessário para Railway e hospedagens seguras
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // onde está o index.html

// ✅ Rota simples de verificação
app.get("/", (req, res) => {
  res.send("✅ API LucreMaisTask está no ar!");
});

// 🔹 Rota para buscar status do usuário
app.get("/api/status/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;

  try {
    const { rows } = await pool.query(
      "SELECT nome, vip, pontos, indicacoes FROM usuarios WHERE telegram_id = $1",
      [telegram_id]
    );

    if (rows.length === 0) {
      await pool.query(
        "INSERT INTO usuarios (telegram_id, nome) VALUES ($1, $2)",
        [telegram_id, "Usuário"]
      );
      return res.json({ nome: "Usuário", vip: false, pontos: 0, indicacoes: 0 });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao buscar status:", err);
    res.status(500).json({ erro: "Erro ao buscar status" });
  }
});

// 🔹 Telegram Bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMaisTask!\nClique abaixo para acessar as tarefas do dia:", {
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

// 🔹 Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
