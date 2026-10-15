// ============================================================
// Одноразовая настройка вебхука.
// Открыть в браузере:
//   https://ТВОЙ-ПРОЕКТ.vercel.app/api/setup?secret=ЗНАЧЕНИЕ_WEBHOOK_SECRET
//
// ?action=info   — посмотреть текущее состояние вебхука
// ?action=delete — отключить вебхук
// ============================================================

const TG_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

async function tg(method, payload = {}) {
  const r = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

export default async function handler(req, res) {
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
    return res.status(500).json({ error: 'WEBHOOK_SECRET не задан в переменных Vercel' });
  }
  if (req.query.secret !== secret) {
    return res.status(401).json({ error: 'Неверный secret' });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `https://${host}/api/webhook`;
  const action = req.query.action || 'set';

  try {
    if (action === 'info') {
      return res.status(200).json(await tg('getWebhookInfo'));
    }
    if (action === 'delete') {
      return res.status(200).json(await tg('deleteWebhook', { drop_pending_updates: true }));
    }

    const result = await tg('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });

    return res.status(200).json({ webhook_url: url, telegram: result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
