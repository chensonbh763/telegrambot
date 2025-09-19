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
  const rawTelegramId = req.query.telegram_id;

  // Converte para número se possível
  const telegram_id = parseInt(rawTelegramId, 10);

  if (isNaN(telegram_id)) {
    return res.status(400).json({ erro: "telegram_id inválido" });
  }

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
        ON t.id::text = tc.tarefa_id -- converte t.id para texto para compatibilidade
        AND tc.telegram_id::integer = $1 -- converte tc.telegram_id para inteiro
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

  // Captura o IP real do usuário
  const ipReal = (req.headers["x-forwarded-for"] || req.connection.remoteAddress || "0.0.0.0").split(",")[0].trim();

  try {
    // Verifica se a tarefa já foi concluída hoje
    const check = await pool.query(
      `SELECT 1 FROM tarefas_concluidas 
       WHERE telegram_id = $1 AND tarefa_id = $2 AND DATE(data) = CURRENT_DATE`,
      [telegram_id, tarefa_id]
    );

    if (check.rows.length > 0) {
      return res.status(400).json({ erro: "❌ Essa tarefa já foi concluída hoje." });
    }

    // Registra a conclusão da tarefa
    await pool.query(
      `INSERT INTO tarefas_concluidas (telegram_id, tarefa_id, pontos, data)
       VALUES ($1, $2, $3, NOW())`,
      [telegram_id, tarefa_id, pontos]
    );

    // Atualiza os pontos do usuário
    await pool.query(
      `UPDATE usuarios
       SET pontos = COALESCE(pontos, 0) + $1,
           tarefas_feitas = COALESCE(tarefas_feitas, 0) + 1
       WHERE telegram_id = $2`,
      [pontos, telegram_id]
    );

    // Verifica se esse usuário foi indicado e se o indicador ainda não recebeu os pontos
    const indicacao = await pool.query(
      `SELECT * FROM indicacoes 
       WHERE id_indicado = $1 AND pontos_ativados = false`,
      [telegram_id]
    );

    if (indicacao.rows.length > 0) {
      const indicadorId = indicacao.rows[0].id_indicador;

      // Atualiza status da indicação
      await pool.query(
        `UPDATE indicacoes 
         SET pontos_ativados = true, ip = $1 
         WHERE id_indicado = $2`,
        [ipReal, telegram_id]
      );

      // Recompensa o indicador com 5 pontos
      await pool.query(
        `UPDATE usuarios 
         SET pontos = COALESCE(pontos, 0) + 5,
             indicacoes = COALESCE(indicacoes, 0) + 1
         WHERE telegram_id = $1`,
        [indicadorId]
      );
    }

    res.json({ mensagem: "✅ Pontos registrados com sucesso!" });

  } catch (err) {
    console.error("Erro ao concluir tarefa:", err.message);
    res.status(500).json({
      erro: "Erro ao registrar tarefa",
      detalhe: err.message
    });
  }
});

app.post("/api/roleta/girar", async (req, res) => {
  const { telegram_id, premio_id } = req.body;

  const premios = {
    1: { tipo: "pontos", valor: 5 },
    2: { tipo: "pontos", valor: 10 },
    3: { tipo: "pontos", valor: 15 },
    4: { tipo: "nada", valor: 0 },
    5: { tipo: "pontos", valor: 5 },
    6: { tipo: "pontos", valor: 10 },
    7: { tipo: "pontos", valor: 15 },
    8: { tipo: "nada", valor: 0 },
    9: { tipo: "pontos", valor: 20 },
    10: { tipo: "pontos", valor: 25 },
    11: { tipo: "pontos", valor: 30 },
    12: { tipo: "pontos", valor: 40 }
  };

  try {
    const premio = premios[premio_id];
    if (!premio) return res.status(400).json({ erro: "Prêmio inválido." });

    // Verifica se usuário existe
    const userRes = await pool.query("SELECT * FROM usuarios WHERE telegram_id = $1", [telegram_id]);
    if (userRes.rows.length === 0) return res.status(404).json({ erro: "Usuário não encontrado." });

    const user = userRes.rows[0];

    // Limite diário de giros (VIP e não VIP)
    const limiteGirosDiarios = 5;
    const girosHoje = await pool.query(
      `SELECT COUNT(*) FROM roleta_giros WHERE telegram_id = $1 AND DATE(data) = CURRENT_DATE`,
      [telegram_id]
    );
    if (parseInt(girosHoje.rows[0].count) >= limiteGirosDiarios) {
      return res.status(400).json({ erro: `Limite diário de ${limiteGirosDiarios} giros atingido.` });
    }

    // Verifica se é VIP e se já girou grátis hoje
    let usouTicketGratuito = false;
    const vip = user.vip;

    if (vip) {
      const giroHoje = await pool.query(
        `SELECT 1 FROM roleta_giros 
         WHERE telegram_id = $1 AND DATE(data) = CURRENT_DATE`,
        [telegram_id]
      );
      if (giroHoje.rows.length === 0) {
        usouTicketGratuito = true;
      }
    }

    // Se não usou ticket gratuito, cobra 10 pontos
    if (!usouTicketGratuito) {
      if (user.pontos < 10) {
        return res.status(400).json({ erro: "Pontos insuficientes para girar (mínimo 10)." });
      }

      await pool.query("UPDATE usuarios SET pontos = pontos - 10 WHERE telegram_id = $1", [telegram_id]);
    }

    // Aplica o prêmio
    if (premio.tipo === "pontos") {
      await pool.query("UPDATE usuarios SET pontos = pontos + $1 WHERE telegram_id = $2", [premio.valor, telegram_id]);
    }

    // Registra o giro na roleta
    await pool.query(
      "INSERT INTO roleta_giros (telegram_id, premio, pontos_ganhos) VALUES ($1, $2, $3)",
      [telegram_id, premio.tipo, premio.tipo === "pontos" ? premio.valor : 0]
    );

    res.json({
      mensagem: "Giro registrado",
      premio: premio.tipo,
      valor: premio.valor,
      tipo: premio.tipo
    });

  } catch (err) {
    console.error("Erro ao girar roleta:", err.message);
    res.status(500).json({ erro: "Erro interno no servidor." });
  }
});
app.get("/api/roleta/hoje", async (req, res) => {
  const { telegram_id } = req.query;
  const check = await pool.query(
    "SELECT 1 FROM roleta_giros WHERE telegram_id = $1 AND DATE(data) = CURRENT_DATE",
    [telegram_id]
  );
  res.json({ girou: check.rows.length > 0 });
});

app.get("/api/roleta/historico", async (req, res) => {
  const { telegram_id } = req.query;
  const { rows } = await pool.query(
  "SELECT premio, pontos_ganhos, data FROM roleta_giros WHERE telegram_id = $1 ORDER BY data DESC LIMIT 10",
  [telegram_id]
);
  res.json(rows);
});

app.get("/ofertas/bitlabs", (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send("ID do usuário é obrigatório.");

  const token = process.env.BITLABS_TOKEN;
  const url = `https://web.bitlabs.ai/?uid=${user_id}&token=${token}`;
  res.redirect(url);
});
app.post("/api/bitlabs/callback", express.json(), async (req, res) => {
  const { user_id, amount } = req.body;

  // Atualize o saldo do usuário
  await db.query("UPDATE usuarios SET pontos = pontos + $1 WHERE telegram_id = $2", [amount, user_id]);

  res.status(200).send("OK");
});

app.get("/cpalead-postback", async (req, res) => {
  const { subid, payout, offer_id, campaign_name } = req.query;

  console.log("📥 Postback recebido:", { subid, payout, offer_id, campaign_name });

  // Validação básica
  if (!subid || !payout || !offer_id) {
    console.error("❌ Dados incompletos no postback.");
    return res.status(400).send("❌ Dados incompletos.");
  }

  const telegram_id = subid.replace("telegram_", "");
  const payoutFloat = parseFloat(payout);

  if (isNaN(payoutFloat)) {
    console.error("❌ Payout inválido:", payout);
    return res.status(400).send("❌ Payout inválido.");
  }

  const pontos = Math.round(payoutFloat * 50); // 50 pontos por US$1.00

  try {
    // Verifica se a tarefa já foi registrada
    const check = await pool.query(
      "SELECT * FROM tarefas_concluidas WHERE telegram_id = $1 AND tarefa_id = $2",
      [telegram_id, offer_id]
    );

    if (check.rowCount > 0) {
      console.log("ℹ️ Tarefa já registrada.");
      return res.status(200).send("✅ Tarefa já registrada.");
    }

    // Insere a tarefa com origem e nome
    await pool.query(
      `INSERT INTO tarefas_concluidas (telegram_id, tarefa_id, pontos, data, origem, nome_tarefa)
       VALUES ($1, $2, $3, NOW(), $4, $5)`,
      [telegram_id, offer_id, pontos, 'cpalead', campaign_name || 'Oferta CPAlead']
    );

    // Atualiza os pontos do usuário
    await pool.query(
      `UPDATE usuarios
       SET pontos = COALESCE(pontos, 0) + $1,
           tarefas_feitas = COALESCE(tarefas_feitas, 0) + 1
       WHERE telegram_id = $2`,
      [pontos, telegram_id]
    );

    console.log(`✅ ${pontos} pontos adicionados para o usuário ${telegram_id}`);
    res.status(200).send("✅ Pontos adicionados com sucesso.");
  } catch (err) {
    console.error("❌ Erro interno no postback:", err.message);
    res.status(500).send("❌ Erro interno.");
  }
});





//adgem-callback

app.get("/api/adgem-callback", async (req, res) => {
  const { userid, amount, offer_id, goal_id, campaign_id, transaction_id } = req.query;

  // Extrai o telegram_id do formato "telegram_123456"
  const telegram_id = userid?.replace("telegram_", "");

  if (!telegram_id || !amount) {
    return res.status(400).send("Dados inválidos");
  }

  const pontos = Math.floor(parseFloat(amount) * 60); // Multiplicador definido na AdGem

  try {
    // Verifica se essa conversão já foi registrada
    const check = await pool.query(
      `SELECT 1 FROM tarefas_concluidas WHERE tarefa_id = $1 AND telegram_id = $2`,
      [transaction_id, telegram_id]
    );

    if (check.rows.length > 0) {
      return res.status(200).send("Tarefa já registrada");
    }

    // Registra a tarefa como concluída
    await pool.query(
      `INSERT INTO tarefas_concluidas (telegram_id, tarefa_id, pontos, data)
       VALUES ($1, $2, $3, NOW())`,
      [telegram_id, transaction_id, pontos]
    );

    // Atualiza os pontos do usuário
    await pool.query(
      `UPDATE usuarios
       SET pontos = COALESCE(pontos, 0) + $1,
           tarefas_feitas = COALESCE(tarefas_feitas, 0) + 1
       WHERE telegram_id = $2`,
      [pontos, telegram_id]
    );

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro no callback AdGem:", err.message);
    res.status(500).send("Erro interno");
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

// 🔹 8. Telegram Bot com Webhook
const bot = new TelegramBot(process.env.BOT_TOKEN);

app.post("/", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

async function initBot() {
  await bot.setWebHook(`${process.env.BASE_URL}/`);
  console.log("✅ Webhook definido com sucesso!");
}
initBot();

const GRUPO_VIP_ID = -1002605364157;

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
        const ip = msg?.web_app_data?.ip || "0.0.0.0";

        const ipCount = await pool.query(
          "SELECT COUNT(*) FROM indicacoes WHERE ip = $1",
          [ip]
        );

        if (parseInt(ipCount.rows[0].count) >= 3) {
          bot.sendMessage(chatId, "🚫 Limite de indicações por IP atingido.");
        } else {
          await pool.query(
            `INSERT INTO indicacoes (id_indicador, id_indicado, ip, data, pontos_ativados)
             VALUES ($1, $2, $3, NOW(), false)`,
            [indicadorId, indicadoId, ip]
          );

          await pool.query(
            `UPDATE usuarios SET pontos = COALESCE(pontos, 0) + 5 WHERE telegram_id = $1`,
            [indicadoId]
          );

          bot.sendMessage(chatId, "🎉 Indicação registrada! Você ganhou 5 pontos.");
        }
      } else {
        bot.sendMessage(chatId, "ℹ️ Você já foi indicado anteriormente.");
      }
    }

    try {
      const member = await bot.getChatMember(GRUPO_VIP_ID, chatId);
      const status = member?.status;
      const isVip = status === "member" || status === "administrator" || status === "creator";

      await pool.query(
        "UPDATE usuarios SET vip = $1 WHERE telegram_id = $2",
        [isVip, chatId]
      );
    } catch (err) {
      console.error("Erro ao verificar status VIP:", err.message);
    }

bot.sendMessage(chatId, "👋 Bem-vindo ao LucreMaisTask! Acesse suas tarefas diárias:", {
  reply_markup: {
    inline_keyboard: [[
      {
        text: "📲 Abrir Mini App",
        web_app: {
          url: `https://telegrambot-mlfd.onrender.com/?id=${chatId}`
        }
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
