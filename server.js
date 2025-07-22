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

// ✅ Checagem de API
app.get("/", (req, res) => {
  res.send("🚀 API LucreMaisTask está no ar!");
});

// 🔹 Listar tarefas ativas
app.get("/api/tarefas", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM tarefas WHERE ativa = true ORDER BY id DESC");
    res.json(rows);
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error.message);
    res.status(500).json({ erro: "Erro ao listar tarefas", detalhe: error.message });
  }
});

// 🔹 Criar nova tarefa (painel admin)
app.post("/admin/tarefa", async (req, res) => {
  const { titulo, link, dia, pontos } = req.body;
  try {
    await pool.query(
      "INSERT INTO tarefas (titulo, link, dia, pontos, ativa) VALUES ($1, $2, $3, $4, true)",
      [titulo, link, dia, pontos]
    );
    res.send("✅ Tarefa criada com sucesso!");
  } catch (err) {
    console.error("Erro ao criar tarefa:", err.message);
    res.status(500).send("Erro ao criar tarefa.");
  }
});

// 🔹 Executar comandos SQL (painel admin)
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

// 🔹 Concluir tarefa com validação de repetição
app.post("/api/concluir-tarefa", async (req, res) => {
  const { telegram_id, tarefa_id, pontos } = req.body;

  try {
    // Verifica se o usuário já concluiu essa tarefa hoje
    const check = await pool.query(
      `SELECT 1 FROM tarefas_concluidas WHERE telegram_id = $1 AND tarefa_id = $2 AND DATE(data) = CURRENT_DATE`,
      [telegram_id, tarefa_id]
    );

    if (check.rows.length > 0) {
      return res.status(400).json({ erro: "❌ Essa tarefa já foi concluída hoje." });
    }

    // Registra a tarefa concluída
    await pool.query(
      `INSERT INTO tarefas_concluidas (telegram_id, tarefa_id, pontos, data)
       VALUES ($1, $2, $3, NOW())`,
      [telegram_id, tarefa_id, pontos]
    );

    // Atualiza os pontos e tarefas feitas do usuário
    await pool.query(
      `UPDATE usuarios
       SET pontos = COALESCE(pontos, 0) + $1,
           tarefas_feitas = COALESCE(tarefas_feitas, 0) + 1
       WHERE telegram_id = $2`,
      [pontos, telegram_id]
    );

    res.json({ mensagem: "✅ Pontos registrados com sucesso!" });

  } catch (err) {
    console.error("Erro ao concluir tarefa:", err.message);
    res.status(500).json({
      erro: "Erro ao registrar tarefa",
      detalhe: err.message
    });
  }
});

// 🔹 Bot do Telegram
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const indicadoId = msg.from.id;
  const indicadorId = match[1];
  const nome = msg.from.first_name;

  try {
    // Cadastra usuário se ainda não existe
    await pool.query(
      `INSERT INTO usuarios (telegram_id, nome)
       VALUES ($1, $2)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [indicadoId, nome]
    );

    // Registra indicação se for válida
    if (indicadorId && indicadorId !== indicadoId.toString()) {
      const check = await pool.query(
        "SELECT * FROM indicacoes WHERE id_indicado = $1",
        [indicadoId]
      );

      if (check.rowCount === 0) {
        await pool.query(
          "INSERT INTO indicacoes (id_indicador, id_indicado, data) VALUES ($1, $2, NOW())",
          [indicadorId, indicadoId]
        );

        await pool.query(
          `UPDATE usuarios
           SET indicacoes = COALESCE(indicacoes, 0) + 1
           WHERE telegram_id = $1`,
          [indicadorId]
        );

        bot.sendMessage(chatId, "🎉 Indicação registrada com sucesso!");
      } else {
        bot.sendMessage(chatId, "ℹ️ Você já foi indicado anteriormente.");
      }
    }

    // Resposta padrão
    bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMaisTask! Acesse suas tarefas diárias:", {
      reply_markup: {
        inline_keyboard: [[
          {
            text: "📲 Abrir Mini App",
            web_app: { url: `https://web-production-10f9d.up.railway.app?id=${chatId}` }
          }
        ]]
      }
    });
  } catch (err) {
    console.error("Erro no bot:", err.message);
    bot.sendMessage(chatId, `⚠️ Erro no cadastro: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`✅ API e Bot rodando na porta ${PORT}`);
});
