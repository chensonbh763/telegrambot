require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ✅ REGISTRAR INDICAÇÃO
app.post("/api/indicacoes", async (req, res) => {
  const { indicado, referrer } = req.body;

  if (!indicado || !referrer || indicado === referrer) {
    return res.status(400).json({ erro: "Dados inválidos." });
  }

  try {
    const existe = await pool.query(
      "SELECT 1 FROM indicacoes WHERE indicado = $1",
      [indicado]
    );

    if (existe.rowCount > 0) {
      return res.status(200).json({ mensagem: "Já registrado." });
    }

    await pool.query(
      "INSERT INTO indicacoes (indicado, referrer) VALUES ($1, $2)",
      [indicado, referrer]
    );

    res.status(201).json({ mensagem: "Indicação registrada com sucesso!" });
  } catch (err) {
    console.error("Erro ao registrar indicação:", err);
    res.status(500).json({ erro: "Erro interno ao salvar indicação." });
  }
});

// ✅ CONSULTAR INFO DE INDICAÇÕES (por ID)
app.get("/api/indicacoes/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const { rows: indicacoes } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM indicacoes WHERE referrer = $1",
      [id]
    );

    const { rows: ref } = await pool.query(
      "SELECT referrer FROM indicacoes WHERE indicado = $1",
      [id]
    );

    const referrer = ref[0]?.referrer || null;

    res.json({
      referrer,
      totalIndicados: indicacoes[0].total,
      pontos: indicacoes[0].total // 1 ponto por indicado
    });
  } catch (err) {
    console.error("Erro ao buscar dados:", err);
    res.status(500).json({ erro: "Erro interno ao consultar." });
  }
});

app.listen(PORT, () => {
  console.log("✅ API ativa na porta", PORT);
});
