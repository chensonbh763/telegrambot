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

app.get("/", (req, res) => {
  res.send("🚀 API LucreMaisTask está no ar!");
});

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

app.post("/api/concluir-tarefa", async (req, res) => {
  const { telegram_id, tarefa_id, pontos } = req.body;

  try {
    const check = await pool.query(
      `SELECT 1 FROM tarefas_concluidas WHERE telegram_id = $1 AND tarefa_id = $2`,
      [telegram_id, tarefa_id]
    );

    if (check.rows.length > 0) {
      return res.status(400).json({ erro: "❌ Essa tarefa já foi concluída hoje." });
    }

    await pool.query(`
      INSERT INTO tarefas_concluidas (telegram_id, tarefa_id, pontos, data)
      VALUES ($1, $2, $3, NOW())
    `, [telegram_id, tarefa_id, pontos]);

    await pool.query(`
      UPDATE usuarios
      SET pontos = COALESCE(pontos, 0) + $1,
          tarefas_feitas = COALESCE(tarefas_feitas, 0) + 1
      WHERE telegram_id = $2
    `, [pontos, telegram_id]);

    res.json({ mensagem: "✅ Pontos registrados com sucesso!" });
  } catch (err) {
    console.error("Erro ao concluir tarefa:", err.message);
    res.status(500).json({ erro: "Erro ao registrar tarefa" });
  }
});

app.get("/api/ranking", async (req, res) => {
  try {
    const rankingTarefas = await pool.query(`
      SELECT telegram_id, nome, pontos
      FROM usuarios
      ORDER BY pontos DESC
      LIMIT 5
    `);

    const rankingIndicacoes = await pool.query(`
      SELECT telegram_id, nome, indicacoes
      FROM usuarios
      ORDER BY indicacoes DESC
      LIMIT 5
    `);

    res.json({
      tarefas: rankingTarefas.rows,
      indicacoes: rankingIndicacoes.rows
    });
  } catch (err) {
    console.error("Erro ao buscar ranking:", err.message);
    res.status(500).json({ erro: "Erro ao buscar ranking" });
  }
});

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const indicadoId = msg.from.id;
  const indicadorId = match[1];
  const nome = msg.from.first_name;

  try {
    await pool.query(`
      INSERT INTO usuarios (telegram_id, nome)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) DO NOTHING
    `, [indicadoId, nome]);

    if (indicadorId && indicadorId !== indicadoId.toString()) {
      const check = await pool.query(
        "SELECT * FROM indicacoes WHERE id_indicado = $1",
        [indicadoId]
      );

      if (check.rows.length === 0) {
        await pool.query(
          "INSERT INTO indicacoes (id_indicador, id_indicado, data) VALUES ($1, $2, NOW())",
          [indicadorId, indicadoId]
        );

        await pool.query(`
          UPDATE usuarios
          SET indicacoes = COALESCE(indicacoes, 0) + 1
          WHERE telegram_id = $1
        `, [indicadorId]);

        bot.sendMessage(chatId, "🎉 Indicação registrada com sucesso!");
      } else {
        bot.sendMessage(chatId, "ℹ️ Você já foi indicado anteriormente.");
      }
    }

    bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMaisTask!\nClique no botão abaixo para acessar as tarefas do dia. 💸", {
      reply_markup: {
        inline_keyboard: [[
          {
            text: "📲 Acessar Mini App",
            web_app: { url: "https://web-production-10f9d.up.railway.app/indicacoes.html" }
          }
        ]]
      }
    });

  } catch (err) {
    console.error("Erro no bot:", err.message);
    bot.sendMessage(chatId, `⚠️ Erro: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`✅ API e Bot rodando na porta ${PORT}`);
});
