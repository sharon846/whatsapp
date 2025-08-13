// whatsapp-send.js
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const {
  findChat,
  listGroups,
  listContacts,
  sendMessageWithOptionalMedia
} = require("./wa-helper");


function registerWhatsAppRoutes(app, client) {
  if (!app) throw new Error("Express app is required");
  if (!client) throw new Error("WhatsApp client is required");
  app.use(bodyParser.json());

  let isReady = !!client.info?.wid; // true if already ready
  client.on("ready", () => { isReady = true; });

  function requireReady(res) {
    if (!isReady) {
      res.status(503).json({ error: "Client not ready" });
      return false;
    }
    return true;
  }

  // ========== Retrieval ==========
  app.get("/groups", async (req, res) => {
    if (!requireReady(res)) return;
    res.json(await listGroups(client));
  });

  app.get("/contacts", async (req, res) => {
    if (!requireReady(res)) return;
    res.json(await listContacts(client));
  });

  app.get("/find_chat", async (req, res) => {
    if (!requireReady(res)) return;
    const q = (req.query.q || "").toString();
    const chat = await findChat(client, q);
    if (!chat) return res.status(404).json({ error: `Chat not found for: ${q}` });
    res.json({
      id: chat.id._serialized,
      name: chat.name || chat.formattedTitle || "",
      isGroup: !!chat.isGroup,
    });
  });

  // ========== Sending ==========
  // Body: { target: "<name | id | phone>", message: "text", file?: "/abs/path/to/media" }
  app.post("/send_chat", async (req, res) => {
    if (!requireReady(res)) return;
    const { target, message, file } = req.body || {};
    if (!target || !message) {
      return res.status(400).json({ error: "Provide 'target' and 'message'." });
    }

    const chat = await findChat(client, target);
    if (!chat) {
      return res.status(404).json({ error: `Chat not found: ${target}` });
    }

    try {
      await sendMessageWithOptionalMedia(client, chat.id._serialized, message, file);
      res.json({ status: "Message sent." });
    } catch (err) {
      console.error(`Error sending message to ${target}:`, err);
      res.status(500).json({ error: "Failed to send message." });
    }
  });

  return { unregister: () => {/* if you add listeners, detach them here */} };
}

module.exports = { registerWhatsAppRoutes };
