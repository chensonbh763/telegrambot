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

app.listen(PORT, () => {
  console.log("✅ API de Check-in ativa na porta", PORT);
});
