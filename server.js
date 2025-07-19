require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Check-in do usuário
app.post("/api/checkin", async (req, res) => {
  const { telegram_id } = req.body;
  const hoje = new Date().toISOString().split("T")[0];

  try {
    const existe = await pool.query(
      "SELECT 1 FROM checkins WHERE telegram_id = $1 AND data = $2",
      [telegram_id, hoje]
    );

    if (existe.rowCount > 0) {
      return res.status(200).json({ mensagem: "✅ Check-in já feito hoje." });
    }

    await pool.query(
      "INSERT INTO checkins (telegram_id, data, pontos) VALUES ($1, $2, 1)",
      [telegram_id, hoje]
    );

    res.json({ mensagem: "🎉 Check-in registrado e pontos adicionados!" });
  } catch (err) {
    console.error("Erro ao registrar check-in:", err);
    res.status(500).json({ erro: "Erro ao registrar check-in" });
  }
});
// Registrar indicação
app.post("/api/indicacoes", async (req, res) => {
  const { indicado, referrer } = req.body;

  if (!indicado || !referrer || indicado === referrer) {
    return res.status(400).json({ erro: "Dados inválidos para indicação." });
  }

  try {
    // Verifica se já existe indicação desse referrer para esse indicado
    const existe = await pool.query(
      "SELECT 1 FROM indicacoes WHERE indicado = $1",
      [indicado]
    );

    if (existe.rowCount > 0) {
      return res.status(200).json({ mensagem: "Indicação já registrada." });
    }

    await pool.query(
      "INSERT INTO indicacoes (indicado, referrer) VALUES ($1, $2)",
      [indicado, referrer]
    );

    res.status(201).json({ mensagem: "🎉 Indicação registrada com sucesso!" });
  } catch (err) {
    console.error("Erro ao registrar indicação:", err);
    res.status(500).json({ erro: "Erro ao registrar indicação" });
  }
});
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


app.listen(PORT, () => {
  console.log("✅ API de Check-in ativa na porta", PORT);
});
