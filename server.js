require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || "https://web-production-10f9d.up.railway.app";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ✅ Rota principal
app.get("/", (req, res) => {
  res.send("🚀 API LucreMaisTask está no ar!");
});

// 🔹 Obter status do usuário
app.get("/api/status/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;

  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE telegram_id = $1", [telegram_id]);

    if (result.rowCount === 0) {
      await pool.query(
        "INSERT INTO usuarios (telegram_id, nome, tarefas_feitas, vip, pontos, indicacoes) VALUES ($1, $2, 0, false, 0, 0)",
        [telegram_id, "Usuário"]
      );
      return res.json({ telegram_id, nome: "Usuário", vip: false, pontos: 0, indicacoes: 0 });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro status:", err);
    res.status(500).json({ erro: "Erro ao buscar status" });
  }
});

// 🔹 Atribuir tarefas ao usuário
app.post("/api/atribuir_tarefas", async (req, res) => {
  const { telegram_id } = req.body;
  if (!telegram_id) return res.status(400).send("❌ Telegram ID ausente.");

  const hoje = new Date().toISOString().split("T")[0];

  try {
    const existe = await pool.query(
      "SELECT 1 FROM tarefas_usuario WHERE telegram_id = $1 AND data_criada = $2",
      [telegram_id, hoje]
    );
    if (existe.rowCount > 0) return res.send("🔁 Tarefas já atribuídas.");

    const tarefas = await pool.query("SELECT * FROM tarefas WHERE ativa = true");

    for (const t of tarefas.rows) {
      await pool.query(
        `INSERT INTO tarefas_usuario (
          telegram_id, tarefa_id, titulo, link, pontos, status, data_criada,
          vip, visibilidade, tipo, validade, expirada
        ) VALUES (
          $1, $2, $3, $4, $5, 'pendente', $6, false, 'todos', 'diaria', NULL, false
        )`,
        [telegram_id, t.id, t.titulo, t.link, t.pontos, hoje]
      );
    }

    res.send("✅ Tarefas atribuídas.");
  } catch (err) {
    console.error("Erro ao atribuir tarefas:", err);
    res.status(500).send("Erro ao atribuir tarefas.");
  }
});

// 🔹 Listar tarefas individuais
app.get("/api/tarefas/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;

  try {
    const tarefas = await pool.query(
      "SELECT * FROM tarefas_usuario WHERE telegram_id = $1 AND status = 'pendente'",
      [telegram_id]
    );
    res.json(tarefas.rows);
  } catch (err) {
    console.error("Erro ao buscar tarefas:", err);
    res.status(500).json({ erro: "Erro ao listar tarefas do usuário" });
  }
});

// 🔹 Concluir tarefa
app.post("/api/concluir", async (req, res) => {
  const { telegram_id, tarefa_id } = req.body;
  const hoje = new Date().toISOString().split("T")[0];

  try {
    await pool.query(
      "UPDATE tarefas_usuario SET status = 'concluida', data_conclusao = $1 WHERE telegram_id = $2 AND tarefa_id = $3",
      [hoje, telegram_id, tarefa_id]
    );

    await pool.query(
      `UPDATE usuarios
       SET pontos = pontos + (
         SELECT pontos FROM tarefas_usuario WHERE telegram_id = $1 AND tarefa_id = $2
       ), tarefas_feitas = tarefas_feitas + 1
       WHERE telegram_id = $1`,
      [telegram_id, tarefa_id]
    );

    res.json({ mensagem: "Tarefa concluída." });
  } catch (err) {
    console.error("Erro ao concluir tarefa:", err);
    res.status(500).json({ erro: "Erro ao concluir tarefa" });
  }
});


// ✅ Telegram Bot via webhook
const bot = new TelegramBot(process.env.BOT_TOKEN);
bot.setWebHook(`${DOMAIN}/api/bot`);

app.post("/api/bot", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  // Registra o usuário e atribui tarefas
  await fetch(`${DOMAIN}/api/status/${chatId}`); // Cria se não existir
  await fetch(`${DOMAIN}/api/atribuir_tarefas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id: chatId }),
  });

  bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMaisTask!", {
    reply_markup: {
      inline_keyboard: [[
        {
          text: "📲 Acessar Mini App",
          web_app: { url: `${DOMAIN}?id=${chatId}` }
        }
      ]]
    }
  });
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`✅ API e Bot rodando na porta ${PORT}`);
});
