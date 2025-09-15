// whatsapp-send.js
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const {
  findChat,
  listGroups,
  listContacts,
  sendMessageWithOptionalMedia,
  listGroupParticipants,
  removeGroupParticipant,
  removeAllParticipants
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

  // GET /group_participants?group=<name or id>
  app.get("/group_participants", async (req, res) => {
    if (!requireReady(res)) return;
    const group = (req.query.group || "").toString();
    if (!group) return res.status(400).json({ error: "Provide 'group'." });

    const participants = await listGroupParticipants(client, group);
    if (!participants) return res.status(404).json({ error: "Group not found" });
    res.json(participants);
  });

  // POST /remove_all_participants
  // Body: { group: "<name|id>" }
  app.post("/remove_all_participants", async (req, res) => {
    if (!requireReady(res)) return;
    const { group } = req.body || {};
    if (!group) return res.status(400).json({ error: "Provide 'group'." });

    const result = await removeAllParticipants(client, group);
    if (result.error) return res.status(403).json(result);
    res.json({ status: "All participants removed.", removed: result.removed });
  });

  // POST /remove_participant
  // Body: { group: "<name|id>", participant: "<id serialized>" }
  app.post("/remove_participant", async (req, res) => {
    if (!requireReady(res)) return;
    const { group, participant } = req.body || {};
    if (!group || !participant) {
      return res.status(400).json({ error: "Provide 'group' and 'participant'." });
    }

    const result = await removeGroupParticipant(client, group, participant);
    if (result.error) return res.status(403).json(result);
    res.json({ status: "Participant removed." });
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
