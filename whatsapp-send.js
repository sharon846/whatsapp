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
const { spawn } = require("child_process");


function registerWhatsAppRoutes(app, client) {
  if (!app) throw new Error("Express app is required");
  if (!client) throw new Error("WhatsApp client is required");
  app.use(bodyParser.json());

  let isReady = !!client.info?.wid; // true if already ready
  client.on("ready", () => { isReady = true; });

  // watcher config: { groupId, forwardTo }
  let pdfWatcher = null;

  // Listen for incoming PDF messages in configured group
  client.on("message", async (msg) => {
    try {
      if (!pdfWatcher) return;
      if (msg.from !== pdfWatcher.groupId) return;
      if (!msg.hasMedia || msg.mimetype !== "application/pdf") return;

      const media = await msg.downloadMedia();
      if (!media) return;

      const filename = msg.filename || "file.pdf";
      const dir = path.join(__dirname, "downloads");
      fs.mkdirSync(dir, { recursive: true });
      const originalPath = path.join(dir, `${Date.now()}_${filename}`);
      fs.writeFileSync(originalPath, media.data, { encoding: "base64" });

      // call python processing
      const py = spawn("python3", [path.join(__dirname, "process_pdf.py"), originalPath]);
      let stdout = "";
      py.stdout.on("data", (d) => { stdout += d.toString(); });
      py.stderr.on("data", (d) => console.error("Python:", d.toString()));
      const code = await new Promise((resolve) => py.on("close", resolve));
      if (code !== 0) {
        await client.sendMessage(pdfWatcher.groupId, "PDF processing failed.");
        return;
      }
      const processedPath = stdout.trim().split(/\r?\n/).pop();

      // notify group with new path
      await client.sendMessage(pdfWatcher.groupId, `Processed PDF saved to: ${processedPath}`);

      // send processed PDF to target number
      const targetChat = await findChat(client, pdfWatcher.forwardTo);
      if (targetChat) {
        await sendMessageWithOptionalMedia(
          client,
          targetChat.id._serialized,
          "Processed PDF",
          processedPath
        );
      } else {
        await client.sendMessage(pdfWatcher.groupId, `Target not found: ${pdfWatcher.forwardTo}`);
      }
    } catch (err) {
      console.error("Error handling incoming PDF:", err);
      try { await client.sendMessage(pdfWatcher.groupId, "Error processing PDF."); } catch {}
    }
  });

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

  // Body: { group: "<name | id>", forwardTo: "<phone | contact name>" }
  app.post("/watch_pdf", async (req, res) => {
    if (!requireReady(res)) return;
    const { group, forwardTo } = req.body || {};
    if (!group || !forwardTo) {
      return res.status(400).json({ error: "Provide 'group' and 'forwardTo'." });
    }
    const gchat = await findChat(client, group);
    if (!gchat || !gchat.isGroup) {
      return res.status(404).json({ error: `Group not found: ${group}` });
    }
    pdfWatcher = { groupId: gchat.id._serialized, forwardTo };
    res.json({ status: "Watching for PDFs." });
  });

  return { unregister: () => {/* if you add listeners, detach them here */} };
}

module.exports = { registerWhatsAppRoutes };
