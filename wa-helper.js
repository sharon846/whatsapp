// wa-helper.js
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { MessageMedia } = require("whatsapp-web.js");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);

// === CONFIG ===
const MAX_FILE_SIZE = 64 * 1024 * 1024; // WhatsApp ~64MB

const ALLOWED_MIME_VIDEO = new Set([
  "video/mp4",
  "application/mp4",
  "video/3gp",
  "video/3gpp"
]);
const ALLOWED_MIME_AUDIO = new Set([
  "audio/mpeg", "audio/mp3",
  "audio/aac", "audio/x-aac",
  "audio/mp4", "audio/3gpp",
  "audio/3gpp2", "audio/ogg", "audio/opus"
]);
const ALLOWED_MIME_DOC = new Set([
  "application/pdf"
]);

// Track temp files to clean up
let globalTempFiles = [];
function cleanupTempFiles() {
  for (const tmp of globalTempFiles) {
    if (tmp && fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); console.log(`🗑 Deleted temp file: ${tmp}`); }
      catch (e) { console.error(`Failed to delete temp file ${tmp}:`, e); }
    }
  }
  globalTempFiles = [];
}
process.on("exit", cleanupTempFiles);
process.on("SIGINT", () => { cleanupTempFiles(); process.exit(); });

// --- FFmpeg conversion core ---
function convertFile(inputPath, outputExt, ffmpegConfig) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace(/\.[^/.]+$/i, outputExt);
    globalTempFiles.push(outputPath);
    const cmd = ffmpeg(inputPath);

    if (ffmpegConfig.videoCodec) {
      cmd.videoCodec(ffmpegConfig.videoCodec);
    }
    if (ffmpegConfig.audioCodec) {
      cmd.audioCodec(ffmpegConfig.audioCodec);
    }

    cmd
      .outputOptions(ffmpegConfig.options || [])
      .toFormat(ffmpegConfig.format)
      .on("error", (err) => {
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch {}
        reject(err);
      })
      .on("end", () => resolve(outputPath))
      .save(outputPath);
  });
}

/**
 * Detect, convert if needed, size-check, and return { media, tempFiles, mimeType, file }
 * - Converts:
 *    webm → mp4 (H.264/AAC)
 *    wav  → mp3
 * - Ensures file size <= 16MB
 */
async function detectAndConvertMedia(filePath) {
  const tempFiles = [];
  let file = filePath;

  let mimeType = mime.lookup(file);
  if (!mimeType) return { media: null, tempFiles, file: null, mimeType: null };

  // Convert video/webm → video/mp4
  if (mimeType === "video/webm") {
    try {
      file = await convertFile(file, ".mp4", {
        videoCodec: "libx264",
        audioCodec: "aac",
        format: "mp4",
        options: ["-movflags +faststart", "-pix_fmt yuv420p"]
      });
      tempFiles.push(file);
      mimeType = "video/mp4";
    } catch (e) {
      console.error("WebM→MP4 failed:", e);
      return { media: null, tempFiles, file: null, mimeType: null };
    }
  }

  // Convert wav → mp3
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(mimeType)) {
    try {
      file = await convertFile(file, ".mp3", {
        audioCodec: "libmp3lame",
        format: "mp3"
      });
      tempFiles.push(file);
      mimeType = "audio/mpeg";
    } catch (e) {
      console.error("WAV→MP3 failed:", e);
      return { media: null, tempFiles, file: null, mimeType: null };
    }
  }

  if (mimeType === "application/mp4") mimeType = "video/mp4";

  // Check allowed types + size
  let allowed = false;
  if (mimeType.startsWith("video/")) {
    allowed = ALLOWED_MIME_VIDEO.has(mimeType);
  } else if (mimeType.startsWith("audio/")) {
    allowed = ALLOWED_MIME_AUDIO.has(mimeType);
  } else if (ALLOWED_MIME_DOC.has(mimeType)) {
    allowed = true;
  }
  if (!allowed) return { media: null, tempFiles, file: null, mimeType: null };

  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_SIZE) {
    console.warn(`File too large for WhatsApp: ${(stat.size / (1024*1024)).toFixed(2)}MB`);
    return { media: null, tempFiles, file: null, mimeType: null };
  }

  return { media: MessageMedia.fromFilePath(file), tempFiles, file, mimeType };
}

// --- WhatsApp helpers ---
/**
 * Find a chat by:
 *  - Group:   id ("...@g.us") OR partial/full group name
 *  - Person:  phone ("...@c.us" or digits only) OR partial/full contact name
 * Returns: chat object or null
 */
async function findChat(client, query) {
  const q = (query || "").trim();
  if (!q) return null;

  const chats = await client.getChats();

  // Direct ID? (serialized)
  const direct = chats.find(c => c.id && (c.id._serialized === q));
  if (direct) return direct;

  // Plain phone number?
  const digits = q.replace(/[^\d]/g, "");
  if (digits) {
    const byPhone = chats.find(c => c.id && c.id.user === digits);
    if (byPhone) return byPhone;
  }

  // Name match (group or contact)
  const qLower = q.toLowerCase();
  const byName = chats.find(c => (c.name || c.formattedTitle || "")
    .toLowerCase()
    .includes(qLower));
  if (byName) return byName;

  return null;
}

async function listGroups(client) {
  const chats = await client.getChats();
  return chats.filter(c => c.isGroup).map(g => ({ name: g.name, id: g.id._serialized }));
}

async function listContacts(client) {
  const chats = await client.getChats();
  return chats
    .filter(c => !c.isGroup)
    .map(c => ({
      name: c.name || c.formattedTitle || "",
      id: c.id._serialized,
      phone: c.id.user
    }));
}

/**
 * Send message with optional media. If filePath is provided, we try to convert & send as media with caption.
 * Ensures temp files are deleted after sending.
 */
async function sendMessageWithOptionalMedia(client, chatId, messageText, filePath) {
  const temp = [];
  try {
    if (filePath && fs.existsSync(filePath)) {
      const mediaInfo = await detectAndConvertMedia(filePath);
      temp.push(...(mediaInfo.tempFiles || []));
      if (mediaInfo.media) {
        await client.sendMessage(chatId, mediaInfo.media, { caption: messageText, sendMediaAsDocument: filePath.includes(".pdf") });
        return;
      }
    }
    // fallback to text-only
    await client.sendMessage(chatId, messageText);
  } finally {
    // delete temp files created during conversion
    for (const t of temp) {
      if (t && fs.existsSync(t)) {
        try { fs.unlinkSync(t); console.log(`🗑 Deleted temp file: ${t}`); }
        catch (e) { console.error(`Failed to delete temp file ${t}:`, e); }
      }
    }
  }
}

// === Group management helpers ===

/**
 * List participants of a group by name or ID.
 * Returns array of {id, name, isAdmin}.
 */
async function listGroupParticipants(client, groupQuery) {
  const chat = await findChat(client, groupQuery);
  if (!chat || !chat.isGroup) return null;

  const group = await client.getChatById(chat.id._serialized);
  return group.participants.map(p => ({
    id: p.id._serialized,
    name: p.name || p.pushname || "",
    isAdmin: p.isAdmin || p.isSuperAdmin || false,
  }));
}

/**
 * Remove participant from group if caller is admin.
 */
async function removeGroupParticipant(client, groupQuery, participantId) {
  const chat = await findChat(client, groupQuery);
  if (!chat || !chat.isGroup) return { error: "Group not found" };

  const group = await client.getChatById(chat.id._serialized);
  const me = group.participants.find(p => p.id._serialized === client.info.wid._serialized);
  if (!me || (!me.isAdmin && !me.isSuperAdmin)) {
    return { error: "You are not an admin in this group" };
  }

  try {
    await group.removeParticipants([participantId]);
    return { success: true };
  } catch (e) {
    console.error("Failed to remove participant:", e);
    return { error: "Failed to remove participant" };
  }
}

/**
 * Remove all participants from a group (except yourself).
 */
async function removeAllParticipants(client, groupQuery) {
  const chat = await findChat(client, groupQuery);
  if (!chat || !chat.isGroup) return { error: "Group not found" };

  const group = await client.getChatById(chat.id._serialized);
  const me = group.participants.find(p => p.id._serialized === client.info.wid._serialized);
  if (!me || (!me.isAdmin && !me.isSuperAdmin)) {
    return { error: "You are not an admin in this group" };
  }

  // Exclude yourself
  const targets = group.participants
    .filter(p => p.id._serialized !== client.info.wid._serialized)
    .map(p => p.id._serialized);

  if (targets.length === 0) return { success: true, removed: [] };

  try {
    await group.removeParticipants(targets);
    return { success: true, removed: targets };
  } catch (e) {
    console.error("Failed to remove participants:", e);
    return { error: "Failed to remove participants" };
  }
}

module.exports = {
  // config & utils
  detectAndConvertMedia,
  sendMessageWithOptionalMedia,
  cleanupTempFiles,

  // chats
  findChat,
  listGroups,
  listContacts,

  // groups
  listGroupParticipants,
  removeGroupParticipant,
  removeAllParticipants
};
