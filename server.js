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

// ✅ Rota de teste
app.get("/", (req, res) => {
  res.send("🚀 API LucreMaisTask está no ar!");
});


// 🔹 Obter tarefas personalizadas do usuário
app.get("/api/tarefas/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;
  try {
    const { rows } = await pool.query(
      "SELECT * FROM tarefas_usuario WHERE telegram_id = $1 AND status = 'pendente' ORDER BY tarefa_id DESC",
      [telegram_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar tarefas:", err);
    res.status(500).json({ erro: "Erro ao buscar tarefas" });
  }
});


// 🔹 Obter status do usuário
app.get("/api/status/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;
  try {
    const { rows } = await pool.query(
      "SELECT nome, vip, pontos, indicacoes FROM usuarios WHERE telegram_id = $1",
      [telegram_id]
    );
    if (rows.length === 0) {
      await pool.query("INSERT INTO usuarios (telegram_id, nome) VALUES ($1, $2)", [telegram_id, "Usuário"]);
      return res.json({ nome: "Usuário", vip: false, pontos: 0, indicacoes: 0 });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao buscar status:", err);
    res.status(500).json({ erro: "Erro ao buscar status" });
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
       ),
       tarefas_feitas = tarefas_feitas + 1
       WHERE telegram_id = $1`,
      [telegram_id, tarefa_id]
    );

    res.json({ mensagem: "Tarefa concluída com sucesso!" });
  } catch (err) {
    console.error("Erro ao concluir tarefa:", err);
    res.status(500).json({ erro: "Erro ao concluir tarefa" });
  }
});


// 🔹 Registrar usuário e indicação
app.post("/api/registrar", async (req, res) => {
  const { telegram_id, nome, referrer } = req.body;
  try {
    const existe = await pool.query("SELECT 1 FROM usuarios WHERE telegram_id = $1", [telegram_id]);
    if (existe.rowCount === 0) {
      await pool.query("INSERT INTO usuarios (telegram_id, nome) VALUES ($1, $2)", [telegram_id, nome || "Usuário"]);
    }

    if (referrer && referrer !== telegram_id) {
      const indicado = await pool.query("SELECT 1 FROM indicacoes WHERE indicado = $1", [telegram_id]);
      if (indicado.rowCount === 0) {
        const hoje = new Date().toISOString().split("T")[0];
        await pool.query("INSERT INTO indicacoes (indicado, referrer, data) VALUES ($1, $2, $3)", [telegram_id, referrer, hoje]);
        await pool.query("UPDATE usuarios SET pontos = pontos + 3, indicacoes = indicacoes + 1 WHERE telegram_id = $1", [referrer]);
      }
    }

    res.send("Usuário registrado com sucesso.");
  } catch (err) {
    console.error("Erro ao registrar:", err);
    res.status(500).send("Erro ao registrar usuário.");
  }
});


// 🔹 Atribuir tarefas padrão ao usuário
app.post("/api/atribuir_tarefas", async (req, res) => {
  const { telegram_id } = req.body;
  try {
    const tarefas = await pool.query("SELECT * FROM tarefas WHERE ativa = true");
    for (let t of tarefas.rows) {
      await pool.query(
        `INSERT INTO tarefas_usuario 
         (telegram_id, tarefa_id, titulo, link, pontos, status, data_criada, vip, visibilidade, tipo, validade, expirada)
         VALUES ($1, $2, $3, $4, $5, 'pendente', CURRENT_DATE, false, 'todos', 'diaria', NULL, false)
        `,
        [telegram_id, t.id, t.titulo, t.link, t.pontos]
      );
    }
    res.send("Tarefas atribuídas.");
  } catch (err) {
    console.error("Erro ao atribuir tarefas:", err);
    res.status(500).send("Erro ao atribuir tarefas.");
  }
});


// 🔹 Painel admin: criar tarefa base
app.post("/admin/tarefa", async (req, res) => {
  const { titulo, link, dia, pontos } = req.body;
  try {
    await pool.query(
      "INSERT INTO tarefas (titulo, link, dia, pontos, ativa) VALUES ($1, $2, $3, $4, true)",
      [titulo, link, dia, pontos]
    );
    res.send("✅ Tarefa criada com sucesso!");
  } catch (err) {
    console.error("Erro ao criar tarefa:", err);
    res.status(500).send("Erro ao criar tarefa.");
  }
});


// 🔹 Painel admin: executar SQL
app.post("/admin/sql", async (req, res) => {
  const { sql } = req.body;
  try {
    const { rows } = await pool.query(sql);
    res.send(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("Erro SQL:", err.message);
    res.status(400).send("Erro SQL: " + err.message);
  }
});


// 🔹 Bot do Telegram com sistema de indicação + mini app
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referrer = match[1];

  await fetch("https://web-production-10f9d.up.railway.app/api/registrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id: chatId, nome: msg.from.first_name, referrer })
  });

  await fetch("https://web-production-10f9d.up.railway.app/api/atribuir_tarefas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id: chatId })
  });

  bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMaisTask! Acesse seu painel abaixo:", {
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
  console.log(`✅ API + Bot rodando na porta ${PORT}`);
});
