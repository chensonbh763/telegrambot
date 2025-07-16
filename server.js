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

app.get("/api/status/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;

  try {
    const { rows } = await pool.query(
      "SELECT nome, vip, pontos, indicacoes FROM usuarios WHERE telegram_id = $1",
      [telegram_id]
    );

    if (rows.length === 0) {
      // Cria usuário se não existir
      await pool.query(
        "INSERT INTO usuarios (telegram_id, nome) VALUES ($1, $2)",
        [telegram_id, "Usuário"]
      );
      return res.json({ nome: "Usuário", vip: false, pontos: 0, indicacoes: 0 });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Erro ao obter status do usuário:", error);
    res.status(500).json({ erro: "Erro ao buscar status" });
  }
});

app.post("/api/concluir", async (req, res) => {
  const { telegram_id, tarefa_id } = req.body;
  const hoje = new Date().toISOString().split("T")[0];

  try {
    // Verifica se já fez hoje
    const jaFeita = await pool.query(
      "SELECT 1 FROM progresso WHERE telegram_id = $1 AND tarefa_id = $2 AND data = $3",
      [telegram_id, tarefa_id, hoje]
    );

    if (jaFeita.rowCount > 0) {
      return res.status(200).json({ mensagem: "Tarefa já feita hoje" });
    }

    // Marca como feita
    await pool.query(
      "INSERT INTO progresso (telegram_id, tarefa_id, data) VALUES ($1, $2, $3)",
      [telegram_id, tarefa_id, hoje]
    );

    // Atualiza pontos e contador
    await pool.query(
      `UPDATE usuarios
       SET pontos = pontos + (
         SELECT pontos FROM tarefas WHERE id = $1
       ),
       tarefas_feitas = tarefas_feitas + 1
       WHERE telegram_id = $2`,
      [tarefa_id, telegram_id]
    );

    res.json({ mensagem: "Tarefa registrada com sucesso!" });
  } catch (error) {
    console.error("Erro ao concluir tarefa:", error);
    res.status(500).json({ erro: "Erro ao concluir tarefa" });
  }
});
