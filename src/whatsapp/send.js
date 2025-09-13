// src/whatsapp/send.js
const WABA_BASE = process.env.WABA_BASE || "https://graph.facebook.com/v20.0";
const PHONE_ID  = process.env.WHATSAPP_PHONE_ID;   // from Meta
const TOKEN     = process.env.WHATSAPP_ACCESS_TOKEN;

if (!PHONE_ID || !TOKEN) {
  console.warn("⚠️ Missing WHATSAPP_PHONE_ID / WHATSAPP_ACCESS_TOKEN");
}

async function sendWhatsAppText(to, text) {
  const url = `${WABA_BASE}/${PHONE_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.error("❌ WhatsApp send error", res.status, err);
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
  return res.json();
}

module.exports = { sendWhatsAppText };
