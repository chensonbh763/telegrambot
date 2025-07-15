const express = require("express");
const pool = require("./db");
require("dotenv").config();
const app = express();
const cors = require("cors");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Listar todas as tarefas ativas (sem filtro por dia)
app.get("/api/tarefas", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM tarefas WHERE ativa = true"
    );
    res.json(rows);
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error);
    res.status(500).json({ erro: "Falha ao listar tarefas" });
  }
});

// Status do usuário
app.get("/api/status/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;
  const { rows } = await pool.query(
    "SELECT nome, vip, pontos, indicacoes FROM usuarios WHERE telegram_id = $1",
    [telegram_id]
  );
  res.json(rows[0] || {
    nome: "Novo usuário",
    vip: false,
    pontos: 0,
    indicacoes: 0
  });
});

// Marcar tarefa concluída
app.post("/api/concluir", async (req, res) => {
  const { telegram_id, tarefa_id } = req.body;
  const hoje = new Date().toISOString().split("T")[0];

  const jaFeita = await pool.query(
    "SELECT 1 FROM progresso WHERE telegram_id = $1 AND tarefa_id = $2 AND data = $3",
    [telegram_id, tarefa_id, hoje]
  );

  if (jaFeita.rowCount > 0) {
    return res.status(200).json({ mensagem: "Tarefa já feita hoje" });
  }

  await pool.query(
    "INSERT INTO progresso (telegram_id, tarefa_id, data) VALUES ($1, $2, $3)",
    [telegram_id, tarefa_id, hoje]
  );

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
});

// Registrar indicação
app.post("/api/indicar", async (req, res) => {
  const { userid, referrer } = req.body;
  const hoje = new Date().toISOString().split("T")[0];

  const jaTem = await pool.query(
    "SELECT 1 FROM indicacoes WHERE indicado = $1",
    [userid]
  );
  if (jaTem.rowCount > 0) return res.status(200).json({ mensagem: "Já indicado." });

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
// Visualizar dados da conexão (para debug)
app.get("/api/conexao", (req, res) => {
  const { host, port, database, user } = pool.options;
  res.json({ host, port, database, user });
});
