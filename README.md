# 📲 WhatsApp Local API

A lightweight local REST API wrapper around [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js) for sending and receiving messages, managing contacts/groups, and integrating with your own automation pipelines.

This server allows you to:
- List WhatsApp contacts and groups
- Search chats by name, ID, or phone
- Send messages and media to contacts or groups

---

## 🚀 Features
- **GET /groups** – List all groups
- **GET /contacts** – List all contacts
- **GET /find_chat?q=...** – Search chats
- **POST /send_chat** – Send text or media messages

---

## 📦 Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourname/whatsapp.git
cd whatsapp
```

2. **Install dependencies**
```bash
npm install
```

3. **Install Chrome/Chromium**
Make sure you have Google Chrome or Chromium installed.

4. **First-time QR Login**
When the server runs, scan the QR code with your WhatsApp account.

---

## ▶ Usage

### Example entrypoint:
```js
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { registerWhatsAppRoutes } = require("./whatsapp-send");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true }
});

client.on("ready", () => {
  console.log("✅ WhatsApp is ready!");
  registerWhatsAppRoutes(app, client);
  app.listen(5001, "127.0.0.1", () => console.log("API on 5001"));
});

client.initialize();
```

---

## 📡 API Endpoints

### **GET /groups**
List all groups.
**Response:**
```json
[
  { "id": "12345@g.us", "name": "My Group", "isGroup": true },
  ...
]
```

---

### **GET /contacts**
List all contacts.
**Response:**
```json
[
  { "id": "972501234567@c.us", "name": "John Doe", "isGroup": false },
  ...
]
```

---

### **GET /find_chat?q=...**
Search for a chat by **name**, **ID**, or **phone number**.
- **Query:** `q` – required search string
- **Response:**
```json
{ "id": "12345@g.us", "name": "My Group", "isGroup": true }
```
Returns **404** if not found.

---

### **POST /send_chat**
Send a message to a contact or group.

**Body:**
```json
{
  "target": "Friends Group",
  "message": "Hello from API!",
  "file": "C:/path/to/image.jpg" // optional
}
```

**Notes:**
- `target` can be **name**, **chat ID**, or **phone number** (digits only).
- `file` must be an **absolute path**.
- Max file size: **16MB** (WhatsApp limit).

---

## 📋 Parameters & Limitations
| Parameter   | Type     | Required | Description |
|-------------|----------|----------|-------------|
| target      | string   | Yes (for `/send_chat`) | Name, ID, or phone number |
| message     | string   | Yes | Text message content |
| file        | string   | No | Absolute path to media file |
| channel     | string   | Yes (for `/transcription_results`) | Source of transcription |
| time        | string   | Yes | Timestamp of transcription |
| result      | string   | Yes | Transcribed text |
| names       | string[] | No | Explicit recipients (otherwise `phones.txt` is used) |

**General:**
- WhatsApp client must be **ready**; otherwise returns `503`.
- Unsupported file types or >16MB are rejected.
- Phone numbers must be **full international format** (digits only, no `+`).

---

## 📌 Example Requests

**Search for a chat:**
```bash
curl "http://127.0.0.1:5001/find_chat?q=Friends"
```

**Send a message:**
```bash
curl -X POST http://127.0.0.1:5001/send_chat   -H "Content-Type: application/json"   -d '{"target": "John Doe", "message": "Hello!"}'
```

---

## 🛠 Development Notes
- Built on [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js)
- Uses `puppeteer` to control Chrome/Chromium
- QR authentication is persistent via `LocalAuth`

---

## 📜 License
MIT
