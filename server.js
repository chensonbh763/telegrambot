// 🔹 1. Configuração Inicial
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db"); // <-- Arquivo de conexão com o PostgreSQL
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // <-- Pasta onde ficam os arquivos HTML

// 🔹 2. Rota básica
app.get("/", (req, res) => {
  res.send("🚀 API LucreMaisTask rodando com sucesso!");
});

// 🔹 3. Rotas de Tarefas
app.get("/api/tarefas", async (req, res) => {
  const { telegram_id } = req.query;

  try {
    const tarefasQuery = `
      SELECT 
        t.*, 
        CASE 
          WHEN tc.telegram_id IS NOT NULL THEN true 
          ELSE false 
        END AS concluida
      FROM tarefas t
      LEFT JOIN tarefas_concluidas tc 
        ON t.id = tc.tarefa_id 
        AND tc.telegram_id = $1 
        AND DATE(tc.data) = CURRENT_DATE
      WHERE t.ativa = true
      ORDER BY t.id DESC
    `;

    const { rows } = await pool.query(tarefasQuery, [telegram_id]);
    res.json(rows);
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error.message);
    res.status(500).json({ erro: "Erro ao listar tarefas", detalhe: error.message });
  }
});


app.post("/api/concluir-tarefa", async (req, res) => {
  const { telegram_id, tarefa_id, pontos } = req.body;

  try {
    const check = await pool.query(
      `SELECT 1 FROM tarefas_concluidas 
       WHERE telegram_id = $1 AND tarefa_id = $2 AND DATE(data) = CURRENT_DATE`,
      [telegram_id, tarefa_id]
    );

    if (check.rows.length > 0) {
      return res.status(400).json({ erro: "❌ Essa tarefa já foi concluída hoje." });
    }

    await pool.query(
      `INSERT INTO tarefas_concluidas (telegram_id, tarefa_id, pontos, data)
       VALUES ($1, $2, $3, NOW())`,
      [telegram_id, tarefa_id, pontos]
    );

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

// 🔹 4. Rotas de Usuário
app.get("/api/usuarios/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;
  const result = await pool.query("SELECT * FROM usuarios WHERE telegram_id = $1", [telegram_id]);

  if (result.rows.length === 0) return res.status(404).json({ error: "Usuário não encontrado" });

  res.json(result.rows[0]); // Deve conter "pontos"
});


// 🔹 5. Ranking
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

// 🔹 6. Saques
app.post("/api/solicitar-saque", async (req, res) => {
  const { telegram_id, chave_pix, cpf } = req.body;

  if (!telegram_id || !chave_pix || !cpf) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  try {
    const userResult = await pool.query("SELECT pontos, vip FROM usuarios WHERE telegram_id = $1", [telegram_id]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    const { pontos, vip } = userResult.rows[0];
    const pontosMinimos = vip ? 200 : 400;

    if (pontos < pontosMinimos) {
      return res.status(400).json({ error: "Pontos insuficientes para saque." });
    }

    const saqueHoje = await pool.query(`
      SELECT 1 FROM saques
      WHERE telegram_id = $1 AND DATE(data_solicitacao) = CURRENT_DATE
    `, [telegram_id]);

    if (saqueHoje.rows.length > 0) {
      return res.status(400).json({ error: "Você já solicitou um saque hoje. Aguarde a análise." });
    }

    const valor = (pontos * 0.05).toFixed(2);

    await pool.query(`
      INSERT INTO saques (telegram_id, pontos_solicitados, valor_solicitado, chave_pix, cpf, status, data_solicitacao)
      VALUES ($1, $2, $3, $4, $5, 'pendente', NOW())
    `, [telegram_id, pontos, valor, chave_pix, cpf]);

    await pool.query("UPDATE usuarios SET pontos = 0 WHERE telegram_id = $1", [telegram_id]);

    res.json({ success: true, message: "Saque solicitado com sucesso.", valor });
  } catch (err) {
    console.error("Erro ao solicitar saque:", err);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

app.get("/api/saques", async (req, res) => {
  const { telegram_id } = req.query;

  if (!telegram_id) {
    return res.status(400).json({ error: "telegram_id é obrigatório" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT * FROM saques WHERE telegram_id = $1 ORDER BY data_solicitacao DESC",
      [telegram_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar histórico de saques:", err.message);
    res.status(500).json({ error: "Erro ao buscar histórico de saques" });
  }
});

// 🔹 7. Admin
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

// 🔹 8. Telegram Bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const indicadoId = msg.from.id;
  const indicadorId = match[1];
  const nome = msg.from.first_name;

  try {
    await pool.query(
      `INSERT INTO usuarios (telegram_id, nome)
       VALUES ($1, $2)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [indicadoId, nome]
    );

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
          `UPDATE usuarios SET indicacoes = COALESCE(indicacoes, 0) + 1
           WHERE telegram_id = $1`,
          [indicadorId]
        );

        bot.sendMessage(chatId, "🎉 Indicação registrada com sucesso!");
      } else {
        bot.sendMessage(chatId, "ℹ️ Você já foi indicado anteriormente.");
      }
    }

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

// 🔹 9. Inicializar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
