require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 🔹 Rota inicial
app.get("/", (req, res) => {
  res.send("🚀 LucreMais API & Bot estão ativos!");
});

// 🔹 Listar tarefas ativas
app.get("/api/tarefas", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM tarefas WHERE ativa = true");
    res.json(rows);
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error);
    res.status(500).json({ erro: "Erro interno ao listar tarefas" });
  }
});

// 🔹 Buscar status do usuário
app.get("/api/status/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;
  const { rows } = await pool.query(
    "SELECT nome, vip, pontos, indicacoes FROM usuarios WHERE telegram_id = $1",
    [telegram_id]
  );
  res.json(rows[0] || {
    nome: "Novo usuário", vip: false, pontos: 0, indicacoes: 0
  });
});

// 🔹 Concluir tarefa
app.post("/api/concluir", async (req, res) => {
  const { telegram_id, tarefa_id } = req.body;
  const hoje = new Date().toISOString().split("T")[0];

  const jaFeita = await pool.query(
    "SELECT 1 FROM progresso WHERE telegram_id = $1 AND tarefa_id = $2 AND data = $3",
    [telegram_id, tarefa_id, hoje]
  );
  if (jaFeita.rowCount > 0)
    return res.status(200).json({ mensagem: "Tarefa já feita hoje" });

  await pool.query(
    "INSERT INTO progresso (telegram_id, tarefa_id, data) VALUES ($1, $2, $3)",
    [telegram_id, tarefa_id, hoje]
  );
  await pool.query(
    `UPDATE usuarios
     SET pontos = pontos + (
       SELECT pontos FROM tarefas WHERE id = $1
     ), tarefas_feitas = tarefas_feitas + 1
     WHERE telegram_id = $2`,
    [tarefa_id, telegram_id]
  );

  res.json({ mensagem: "Tarefa registrada com sucesso!" });
});

// 🔹 Registrar indicação
app.post("/api/indicar", async (req, res) => {
  const { userid, referrer } = req.body;
  const hoje = new Date().toISOString().split("T")[0];

  const jaTem = await pool.query("SELECT 1 FROM indicacoes WHERE indicado = $1", [userid]);
  if (jaTem.rowCount > 0)
    return res.status(200).json({ mensagem: "Já indicado." });

  await pool.query(
    "INSERT INTO indicacoes (indicado, referrer, data) VALUES ($1, $2, $3)",
    [userid, referrer, hoje]
  );
  await pool.query(
    `UPDATE usuarios
     SET pontos = pontos + 3, indicacoes = indicacoes + 1
     WHERE telegram_id = $1`,
    [referrer]
  );

  res.json({ mensagem: "Indicação registrada com sucesso." });
});

// 🔹 Bot do Telegram
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMais! Acesse seu painel abaixo:", {
    reply_markup: {
      inline_keyboard: [[
        {
          text: "📲 Abrir Mini App",
          web_app: { url: "https://SEU_DOMINIO.com/index.html" }
        }
      ]]
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ API e Bot rodando na porta ${PORT}`);
});
