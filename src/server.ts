import express from "express";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { resetWhatsAppSession, startWhatsAppBot } from "./bot/whatsapp.js";
import { getState, logoutSocket } from "./services/botState.js";
import { clearMasterJid, getMasterJid } from "./services/master.js";
import QRCode from "qrcode";

const app = express();
app.use(express.json());

function adminPageHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>357 Admin</title>
    <style>
      :root {
        --bg: #0b0c10;
        --ink: #e8ecef;
        --muted: #9aa4ad;
        --accent: #ff7a18;
        --accent-2: #0b9dff;
        --panel: #11141b;
        --line: #1b2230;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: radial-gradient(1200px 500px at 10% -10%, #222, transparent),
          radial-gradient(800px 400px at 90% 0%, #1a2333, transparent),
          linear-gradient(180deg, #0b0c10, #0a0e12);
        color: var(--ink);
        font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
        min-height: 100vh;
      }
      .wrap {
        max-width: 1100px;
        margin: 0 auto;
        padding: 48px 20px 80px;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
      }
      .title {
        font-size: 44px;
        letter-spacing: 2px;
        margin: 0;
        font-weight: 700;
        text-transform: uppercase;
      }
      .subtitle {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 16px;
      }
      .badge {
        padding: 8px 14px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.04);
        border-radius: 999px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 22px;
        margin-top: 28px;
      }
      .card {
        background: linear-gradient(180deg, rgba(17, 20, 27, 0.9), rgba(9, 10, 14, 0.9));
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 22px;
        position: relative;
        overflow: hidden;
      }
      .card::after {
        content: "";
        position: absolute;
        inset: 0;
        background: radial-gradient(240px 120px at 90% -10%, rgba(255, 122, 24, 0.15), transparent);
        pointer-events: none;
      }
      .card h2 {
        margin: 0 0 8px;
        font-size: 20px;
      }
      .card p {
        margin: 0 0 14px;
        color: var(--muted);
      }
      .qr {
        width: 100%;
        background: #0b0f16;
        border: 1px dashed var(--line);
        border-radius: 14px;
        padding: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 260px;
      }
      .qr img {
        max-width: 220px;
        width: 100%;
        height: auto;
        filter: drop-shadow(0 0 18px rgba(11, 157, 255, 0.2));
      }
      .status {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        margin-bottom: 10px;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #999;
        box-shadow: 0 0 12px rgba(255, 255, 255, 0.3);
      }
      .dot.open { background: #1ed760; }
      .dot.connecting { background: #ffb347; }
      .dot.close { background: #ff4d4f; }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      button {
        background: linear-gradient(120deg, var(--accent), #ffb347);
        color: #121212;
        border: none;
        padding: 12px 18px;
        border-radius: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      button.secondary {
        background: linear-gradient(120deg, #1e2a3a, #121825);
        color: var(--ink);
        border: 1px solid var(--line);
      }
      button:hover { transform: translateY(-1px); box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25); }
      .footer {
        margin-top: 24px;
        color: var(--muted);
        font-size: 12px;
      }
      .pulse {
        animation: pulse 1.8s ease-in-out infinite;
      }
      @keyframes pulse {
        0% { opacity: 0.7; }
        50% { opacity: 1; }
        100% { opacity: 0.7; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <div>
          <h1 class="title">357 Admin</h1>
          <p class="subtitle">Painel para conectar o WhatsApp e controlar a sessao do bot.</p>
        </div>
        <div class="badge">Canal Master</div>
      </header>
      <div class="grid">
        <div class="card">
          <h2>QR Code</h2>
          <p>Escaneie com o WhatsApp do master para conectar.</p>
          <div class="qr" id="qrBox">
            <span class="pulse">Aguardando QR...</span>
          </div>
        </div>
        <div class="card">
          <h2>Status</h2>
          <div class="status">
            <span class="dot" id="statusDot"></span>
            <span id="statusText">Carregando...</span>
          </div>
          <p id="masterText">Master: --</p>
          <p id="errorText" style="color:#ffb347; font-size:12px;">Erro: --</p>
          <div class="actions">
            <button id="refreshBtn">Gerar novo QR</button>
            <button class="secondary" id="logoutBtn">Desconectar</button>
          </div>
          <div class="footer">Se o QR expirar, clique em Atualizar.</div>
        </div>
      </div>
    </div>
    <script>
      const statusDot = document.getElementById("statusDot");
      const statusText = document.getElementById("statusText");
      const masterText = document.getElementById("masterText");
      const errorText = document.getElementById("errorText");
      const qrBox = document.getElementById("qrBox");
      const refreshBtn = document.getElementById("refreshBtn");
      const logoutBtn = document.getElementById("logoutBtn");

      async function loadStatus() {
        const res = await fetch("/admin/status");
        const data = await res.json();
        statusText.textContent = data.status;
        masterText.textContent = "Master: " + (data.master || "(nao definido)");
        statusDot.className = "dot " + data.status;
        errorText.textContent = "Erro: " + (data.lastError || "-");
      }

      async function loadQr() {
        const res = await fetch("/admin/qr");
        const data = await res.json();
        if (data.qr) {
          qrBox.innerHTML = '<img alt="QR" src="' + data.qr + '" />';
        } else {
          qrBox.innerHTML = '<span class="pulse">QR indisponivel. Aguarde ou atualize.</span>';
        }
      }

      async function logout() {
        await fetch("/admin/logout", { method: "POST" });
        await loadStatus();
        await loadQr();
      }

      refreshBtn.addEventListener("click", async () => {
        await fetch("/admin/reset", { method: "POST" });
        await loadStatus();
        await loadQr();
      });

      logoutBtn.addEventListener("click", logout);

      async function tick() {
        await loadStatus();
        await loadQr();
      }

      tick();
      setInterval(loadStatus, 4000);
      setInterval(loadQr, 8000);
    </script>
  </body>
</html>`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(adminPageHtml());
});

app.get("/admin/status", async (_req, res) => {
  const state = getState();
  const master = await getMasterJid();
  res.json({ status: state.status, master, lastError: state.lastError, updatedAt: state.updatedAt });
});

app.get("/admin/qr", async (_req, res) => {
  const state = getState();
  if (!state.qr) {
    res.json({ qr: null, updatedAt: state.updatedAt });
    return;
  }
  const dataUrl = await QRCode.toDataURL(state.qr, { margin: 1, scale: 6 });
  res.json({ qr: dataUrl, updatedAt: state.updatedAt });
});

app.post("/admin/logout", async (_req, res) => {
  await clearMasterJid();
  await logoutSocket();
  res.json({ ok: true });
});

app.post("/admin/reset", async (_req, res) => {
  await resetWhatsAppSession();
  res.json({ ok: true });
});

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
});

async function bootWhatsApp(): Promise<void> {
  try {
    await startWhatsAppBot();
  } catch (error) {
    logger.error({ error }, "Failed to start WhatsApp bot. Retrying in 5s.");
    setTimeout(() => {
      void bootWhatsApp();
    }, 5000);
  }
}

void bootWhatsApp();
