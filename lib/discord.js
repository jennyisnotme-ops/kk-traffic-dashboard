// lib/discord.js — 用 webhook 發送單張圖片訊息（multipart：payload_json + 檔案附件）
async function sendDigest(webhookUrl, { title, imageBuffer }) {
  const form = new FormData();
  const payload = {
    embeds: [{
      title,
      color: 0x1565c0,
      image: { url: 'attachment://chart.png' },
      timestamp: new Date().toISOString(),
    }],
  };
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([imageBuffer], { type: 'image/png' }), 'chart.png');

  const res = await fetch(webhookUrl, { method: 'POST', body: form });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch (_) { /* 非 JSON 回應則略過細節 */ }
    throw new Error(`Discord webhook 回應 HTTP ${res.status}${detail ? '：' + detail : ''}`);
  }
}

module.exports = { sendDigest };
