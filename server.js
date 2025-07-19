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

// ✅ Rota principal
app.get("/", (req, res) => {
  res.send("🚀 API LucreMaisTask está no ar!");
});

// 🔹 Buscar status do usuário
app.get("/api/status/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT telegram_id, nome, tarefas_feitas, vip, pontos, indicacoes 
       FROM usuarios WHERE telegram_id = $1`,
      [telegram_id]
    );

    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO usuarios (telegram_id, nome, tarefas_feitas, vip, pontos, indicacoes) 
         VALUES ($1, $2, 0, false, 0, 0)`,
        [telegram_id, "Usuário"]
      );
      return res.json({
        telegram_id,
        nome: "Usuário",
        tarefas_feitas: 0,
        vip: false,
        pontos: 0,
        indicacoes: 0
      });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao buscar status:", err);
    res.status(500).json({ erro: "Erro ao buscar status do usuário" });
  }
});

// 🔹 Buscar tarefas individuais pendentes do usuário
app.get("/api/tarefas/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM tarefas_usuario 
       WHERE telegram_id = $1 AND status = 'pendente' 
       ORDER BY id DESC`,
      [telegram_id]
    );
    res.json(rows);
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
    // Marcar como concluída
    await pool.query(
      `UPDATE tarefas_usuario 
       SET status = 'concluida', data_conclusao = $1 
       WHERE telegram_id = $2 AND tarefa_id = $3`,
      [hoje, telegram_id, tarefa_id]
    );

    // Atualizar pontos e tarefas feitas
    await pool.query(
      `UPDATE usuarios SET 
        pontos = pontos + (
          SELECT pontos FROM tarefas_usuario 
          WHERE telegram_id = $1 AND tarefa_id = $2
        ),
        tarefas_feitas = tarefas_feitas + 1
       WHERE telegram_id = $1`,
      [telegram_id, tarefa_id]
    );

    res.json({ mensagem: "✅ Tarefa concluída com sucesso!" });
  } catch (err) {
    console.error("Erro ao concluir tarefa:", err);
    res.status(500).json({ erro: "Erro ao concluir tarefa" });
  }
});

// 🔹 Atribuir tarefas ao novo usuário
app.post("/api/atribuir_tarefas", async (req, res) => {
  const { telegram_id } = req.body;
  if (!telegram_id) return res.status(400).send("❌ Telegram ID ausente.");

  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const existe = await pool.query(
      `SELECT 1 FROM tarefas_usuario WHERE telegram_id = $1 AND data_criada = $2`,
      [telegram_id, hoje]
    );

    if (existe.rows.length > 0)
      return res.send("🔁 Tarefas já atribuídas hoje.");

    const tarefas = await pool.query(
      `SELECT id, titulo, link, pontos, vip, visibilidade, tipo, validade 
       FROM tarefas WHERE ativa = true`
    );

    for (const t of tarefas.rows) {
      await pool.query(
        `INSERT INTO tarefas_usuario (
           telegram_id, tarefa_id, titulo, link, pontos, status, data_criada,
           vip, visibilidade, tipo, validade, expirada
         ) VALUES (
           $1, $2, $3, $4, $5, 'pendente', $6, $7, $8, $9, $10, false
         )`,
        [
          telegram_id,
          t.id,
          t.titulo,
          t.link,
          t.pontos,
          hoje,
          t.vip,
          t.visibilidade,
          t.tipo,
          t.validade
        ]
      );
    }

    res.send("✅ Tarefas atribuídas com sucesso!");
  } catch (err) {
    console.error("Erro ao atribuir tarefas:", err);
    res.status(500).send("Erro ao atribuir tarefas.");
  }
});

// 🔹 Registrar indicação
app.get("/api/indicar", async (req, res) => {
  const { userid, referrer } = req.query;

  if (!userid || !referrer || userid === referrer) {
    return res.status(400).json({ erro: "❌ Dados inválidos ou autoindicação." });
  }

  try {
    const { rows } = await pool.query("SELECT 1 FROM indicacoes WHERE indicado = $1", [userid]);

    if (rows.length > 0) return res.send("🔁 Indicação já registrada.");

    await pool.query("INSERT INTO indicacoes (indicado, indicador) VALUES ($1, $2)", [userid, referrer]);

    await pool.query(
      "UPDATE usuarios SET indicacoes = indicacoes + 1 WHERE telegram_id = $1",
      [referrer]
    );

    res.send("✅ Indicação registrada com sucesso!");
  } catch (err) {
    console.error("Erro ao registrar indicação:", err);
    res.status(500).send("Erro ao registrar indicação.");
  }
});

// 🔹 Criar nova tarefa global (admin)
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

// 🔹 Executar comandos SQL (admin)
app.post("/admin/sql", async (req, res) => {
  const { sql } = req.body;
  try {
    const { rows } = await pool.query(sql);
    res.send(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("Erro SQL:", err);
    res.status(400).send("Erro SQL: " + err.message);
  }
});

// 🔹 Bot Telegram com indicação e Mini App
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referrer = match[1];

  if (referrer && referrer !== String(chatId)) {
    await fetch("https://web-production-10f9d.up.railway.app/api/indicar?userid=" + chatId + "&referrer=" + referrer);
  }

  await fetch("https://web-production-10f9d.up.railway.app/api/atribuir_tarefas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id: chatId })
  });

  bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMaisTask!", {
    reply_markup: {
      inline_keyboard: [[
        {
          text: "📲 Acessar Mini App",
          web_app: { url: `https://web-production-10f9d.up.railway.app?id=${chatId}` }
        }
      ]]
    }
  });
});

// 🔸 Start server
app.listen(PORT, () => {
  console.log(`✅ API e Bot rodando na porta ${PORT}`);
});
