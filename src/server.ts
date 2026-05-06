import express from "express";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { startWhatsAppBot } from "./bot/whatsapp.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
});

void startWhatsAppBot();
