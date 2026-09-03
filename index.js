require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const express = require("express");

// ─────────────────────────────────────────────
// 🚀 BOOT
// ─────────────────────────────────────────────
console.log("🚀 Starting Quick BG Bot...");

if (!process.env.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

if (!process.env.REMOVE_BG_API_KEY) {
  console.error("❌ REMOVE_BG_API_KEY missing");
  process.exit(1);
}

// ─────────────────────────────────────────────
// 🤖 TELEGRAM BOT
// ─────────────────────────────────────────────
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ─────────────────────────────────────────────
// 📊 SIMPLE STATS (in-memory)
// ─────────────────────────────────────────────
const stats = {
  users: new Map(), // userId → username
  totalImages: 0,
  startedAt: new Date().toISOString(),
};

// ─────────────────────────────────────────────
// 📂 DOWNLOAD DIR
// ─────────────────────────────────────────────
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR);
  console.log("📂 Created downloads folder");
}

// ─────────────────────────────────────────────
// ⚠️ BOT ERRORS
// ─────────────────────────────────────────────
bot.on("polling_error", (err) =>
  console.error("❌ Polling error:", err.message)
);

// ─────────────────────────────────────────────
// 👋 /start
// ─────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const userTag = msg.from.username
    ? `@${msg.from.username}`
    : `ID:${msg.from.id}`;

  stats.users.set(msg.from.id, msg.from.username || "NO_USERNAME");

  console.log(`📥 /start from ${userTag}`);

  const keyboard = {
    inline_keyboard: [
      [{ text: 'More Tools', url: 'https://kezio.netlify.app' }],
      [{ text: 'Contact Developer', url: 'https://karojunior.netlify.app' }]
    ]
  };

  bot.sendMessage(
    msg.chat.id,
    `👋 *Quick BG Bot*

Send an image as a *Document* and I’ll remove the background.

⚠️ Sending as Photo reduces quality.`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard
    }
  );
});

// ─────────────────────────────────────────────
// 🔽 DOWNLOAD FROM TELEGRAM
// ─────────────────────────────────────────────
async function downloadTelegramFile(fileId, filename) {
  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  console.log(`⬇️ Downloading: ${fileUrl}`);

  const filePath = path.join(DOWNLOAD_DIR, filename);
  const response = await axios({
    method: "GET",
    url: fileUrl,
    responseType: "stream",
  });

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => {
      console.log(`✅ Saved: ${filePath}`);
      resolve(filePath);
    });
    writer.on("error", reject);
  });
}

// ─────────────────────────────────────────────
// 🎨 REMOVE BACKGROUND (remove.bg)
// ─────────────────────────────────────────────
async function removeBackground(inputPath) {
  console.log("🎨 Sending image to remove.bg");

  const outputPath = inputPath.replace(
    path.extname(inputPath),
    "_nobg.png"
  );

  const imageData = fs.readFileSync(inputPath);

  const res = await axios({
    method: "POST",
    url: "https://api.remove.bg/v1.0/removebg",
    headers: {
      "X-Api-Key": process.env.REMOVE_BG_API_KEY,
    },
    data: {
      image_file_b64: imageData.toString("base64"),
      size: "auto",
    },
    responseType: "arraybuffer",
  });

  fs.writeFileSync(outputPath, res.data);
  console.log(`✅ Background removed: ${outputPath}`);

  return outputPath;
}

// ─────────────────────────────────────────────
// 📩 MESSAGE HANDLER
// ─────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.document && !msg.photo) return;

  const userTag = msg.from.username
    ? `@${msg.from.username}`
    : `ID:${msg.from.id}`;

  stats.users.set(msg.from.id, msg.from.username || "NO_USERNAME");

  // If user sends compressed photo
  if (msg.photo) {
    console.log(`📸 Compressed photo from ${userTag}`);
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Please send the image as a *Document* for best quality.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Document (correct path)
  console.log(
    `📁 Document from ${userTag}: ${msg.document.file_name}`
  );

  stats.totalImages++;

  let statusMsg;

  try {
    statusMsg = await bot.sendMessage(
      msg.chat.id,
      "🧠 Processing image…"
    );

    const inputPath = await downloadTelegramFile(
      msg.document.file_id,
      msg.document.file_name
    );

    await bot.editMessageText("🎨 Removing background…", {
      chat_id: msg.chat.id,
      message_id: statusMsg.message_id,
    });

    const outputPath = await removeBackground(inputPath);

    await bot.sendDocument(msg.chat.id, outputPath, {
      caption: "Processed by @quickbgbot",
    });

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
    console.log("🗑️ Temp files cleaned");
  } catch (err) {
    console.error("❌ Processing error:", err.message);
    bot.sendMessage(
      msg.chat.id,
      "❌ Failed to process image. Please try again."
    );
  }
});

// ─────────────────────────────────────────────
// 🌍 EXPRESS SERVER (RENDER KEEP-ALIVE)
// ─────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Quick BG Bot is alive 🚀");
});

app.get("/stats", (req, res) => {
  res.json({
    startedAt: stats.startedAt,
    totalUsers: stats.users.size,
    totalImages: stats.totalImages,
  });
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});

// 🔁 Self-ping every 10 minutes
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    axios
      .get(process.env.RENDER_EXTERNAL_URL)
      .then(() => console.log("🔁 Self-ping OK"))
      .catch(() => console.log("⚠️ Self-ping failed"));
  }, 10 * 60 * 1000);
}
