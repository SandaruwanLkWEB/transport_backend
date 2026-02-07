const { env } = require("../config/env");

async function sendOtpEmail({ toEmail, toName = "", otp, minutes = 5 }) {
  if (!env.BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is missing");
  }
  if (!env.BREVO_SENDER_EMAIL) {
    throw new Error("BREVO_SENDER_EMAIL is missing");
  }

  const appName = env.APP_NAME || "Transport Request System";
  const subject = `${appName} - Password Reset OTP`;

  const safeName = (toName || "").trim();
  const htmlContent = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2 style="margin:0 0 8px 0">${appName}</h2>
      <p style="margin:0 0 12px 0">ඔබගේ මුරපදය නැවත සකස් කිරීම සඳහා OTP එක මෙන්න:</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:4px;padding:12px 16px;border:1px solid #ddd;border-radius:10px;display:inline-block">
        ${otp}
      </div>
      <p style="margin:12px 0 0 0;color:#555">මෙය මිනිත්තු <b>${minutes}</b>ක් පමණ වලංගුයි.</p>
      <p style="margin:10px 0 0 0;color:#888;font-size:12px">ඔබ මෙය ඉල්ලා නොසිටියා නම්, මෙම email එක නොසලකා හරින්න.</p>
    </div>
  `.trim();

  const payload = {
    sender: {
      name: env.BREVO_SENDER_NAME || appName,
      email: env.BREVO_SENDER_EMAIL
    },
    to: [{ email: toEmail, name: safeName || undefined }],
    subject,
    htmlContent
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = text ? text.slice(0, 300) : "";
    throw new Error(`Brevo send failed: HTTP ${res.status} ${msg}`);
  }
  return true;
}

module.exports = { sendOtpEmail };
