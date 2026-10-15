// ============================================================
// AnonBot — приём апдейтов Telegram (webhook)
// Vercel Serverless Function + Supabase
// ============================================================

const TG_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const OWNER_ID = Number(process.env.OWNER_ID || 0);
const POST_SIGNATURE = process.env.POST_SIGNATURE || '';
const RATE_LIMIT_MESSAGES = Number(process.env.RATE_LIMIT_MESSAGES || 5);
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW || 3600); // секунды

const TEXT_START =
  'Привет. Это анонимный ящик для предложки.\n\n' +
  'Напиши сюда что угодно — текст, фото, видео, гиф или голосовое. ' +
  'Модератор посмотрит и решит, публиковать ли это в канале.\n\n' +
  'Твои данные не передаются: модератор видит только само сообщение.';
const TEXT_SENT = 'Отправлено на модерацию. Ответ придёт сюда же.';
const TEXT_APPROVED = 'Твоё сообщение опубликовано в канале.';
const TEXT_REJECTED = 'Твоё сообщение не прошло модерацию.';

// ─── Telegram API ─────────────────────────────────────────────

async function tg(method, payload) {
  const r = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

const send = (chat_id, text, extra = {}) =>
  tg('sendMessage', { chat_id, text, ...extra });

// ─── Supabase (REST, без SDK) ─────────────────────────────────

const SB_URL = `${process.env.SUPABASE_URL}/rest/v1`;
const SB_HEADERS = () => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

async function sb(path, options = {}) {
  const r = await fetch(`${SB_URL}/${path}`, {
    ...options,
    headers: { ...SB_HEADERS(), ...(options.headers || {}) },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`supabase ${path}: ${r.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

// ─── Настройки ────────────────────────────────────────────────

async function getSetting(key, fallback = '') {
  const rows = await sb(`settings?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows?.[0]?.value ?? fallback;
}

async function setSetting(key, value) {
  await sb('settings', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value }),
  });
}

// ─── Пользователи ─────────────────────────────────────────────

async function upsertUser(user) {
  await sb('users', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
    }),
  });
}

async function isBanned(userId) {
  const rows = await sb(`users?user_id=eq.${userId}&select=is_banned`);
  return !!rows?.[0]?.is_banned;
}

async function setBanned(userId, banned) {
  await sb(`users?user_id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_banned: banned }),
  });
}

async function findUserByUsername(name) {
  const uname = name.replace(/^@/, '');
  const rows = await sb(
    `users?username=ilike.${encodeURIComponent(uname)}&select=user_id,username,first_name&limit=1`
  );
  return rows?.[0] || null;
}

// ─── Модераторы ───────────────────────────────────────────────

async function getModerators() {
  return (await sb('moderators?select=user_id,username,first_name&order=added_at')) || [];
}

async function isModerator(userId) {
  const rows = await sb(`moderators?user_id=eq.${userId}&select=user_id`);
  return !!rows?.length;
}

const isOwner = (userId) => userId === OWNER_ID;
const canModerate = async (userId) => isOwner(userId) || (await isModerator(userId));

// ─── Заявки ───────────────────────────────────────────────────

async function createSubmission(authorId, mediaType, fileId, content) {
  const rows = await sb('submissions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      author_id: authorId,
      media_type: mediaType,
      file_id: fileId,
      content,
    }),
  });
  return rows[0];
}

async function getSubmission(id) {
  const rows = await sb(`submissions?id=eq.${id}&select=*`);
  return rows?.[0] || null;
}

async function saveCopies(id, copies) {
  await sb(`submissions?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ copies }),
  });
}

// Атомарно: заявку заберёт только тот модератор, кто нажал первым
async function claimSubmission(id, status, moderatorId) {
  const rows = await sb(`submissions?id=eq.${id}&status=eq.pending`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status,
      decided_by: moderatorId,
      decided_at: new Date().toISOString(),
    }),
  });
  return rows?.length ? rows[0] : null;
}

async function releaseSubmission(id) {
  await sb(`submissions?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'pending', decided_by: null, decided_at: null }),
  });
}

async function countRecent(authorId) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW * 1000).toISOString();
  const rows = await sb(
    `submissions?author_id=eq.${authorId}&created_at=gte.${since}&select=id`
  );
  return rows?.length || 0;
}

async function stats() {
  const subs = (await sb('submissions?select=status')) || [];
  const users = (await sb('users?select=user_id')) || [];
  const out = { users: users.length, pending: 0, approved: 0, rejected: 0 };
  for (const s of subs) if (out[s.status] !== undefined) out[s.status]++;
  return out;
}

// ─── Разбор сообщения ─────────────────────────────────────────

function extract(msg) {
  if (msg.photo) return ['photo', msg.photo[msg.photo.length - 1].file_id, msg.caption || null];
  if (msg.video) return ['video', msg.video.file_id, msg.caption || null];
  if (msg.animation) return ['animation', msg.animation.file_id, msg.caption || null];
  if (msg.voice) return ['voice', msg.voice.file_id, msg.caption || null];
  if (msg.video_note) return ['video_note', msg.video_note.file_id, null];
  if (msg.audio) return ['audio', msg.audio.file_id, msg.caption || null];
  if (msg.document) return ['document', msg.document.file_id, msg.caption || null];
  if (msg.text) return ['text', null, msg.text];
  return null;
}

async function sendMedia(chatId, sub, caption, replyMarkup) {
  const base = { chat_id: chatId };
  if (replyMarkup) base.reply_markup = replyMarkup;

  switch (sub.media_type) {
    case 'text':
      return tg('sendMessage', { ...base, text: caption || ' ' });
    case 'photo':
      return tg('sendPhoto', { ...base, photo: sub.file_id, caption });
    case 'video':
      return tg('sendVideo', { ...base, video: sub.file_id, caption });
    case 'animation':
      return tg('sendAnimation', { ...base, animation: sub.file_id, caption });
    case 'voice':
      return tg('sendVoice', { ...base, voice: sub.file_id, caption });
    case 'audio':
      return tg('sendAudio', { ...base, audio: sub.file_id, caption });
    case 'document':
      return tg('sendDocument', { ...base, document: sub.file_id, caption });
    case 'video_note': {
      const m = await tg('sendVideoNote', { ...base, video_note: sub.file_id });
      if (caption) await send(chatId, caption);
      return m;
    }
    default:
      return tg('sendMessage', { ...base, text: caption || ' ' });
  }
}

const modKeyboard = (id) => ({
  inline_keyboard: [[
    { text: '✅ Одобрено', callback_data: `ok:${id}` },
    { text: '❌ Не одобрено', callback_data: `no:${id}` },
  ]],
});

const esc = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ══════════════════════════════════════════════════════════════
// КОМАНДЫ
// ══════════════════════════════════════════════════════════════

async function handleCommand(msg, cmd, args) {
  const uid = msg.from.id;
  const chat = msg.chat.id;

  switch (cmd) {
    case '/start':
      await upsertUser(msg.from);
      return send(chat, TEXT_START);

    case '/help': {
      let out = 'Просто отправь сообщение — оно уйдёт на модерацию.\n';
      if (await canModerate(uid)) out += '\n<b>Модератор:</b>\n/pending — сколько заявок ждёт\n';
      if (isOwner(uid))
        out +=
          '\n<b>Владелец:</b>\n' +
          '/addmod &lt;id или @username&gt; — назначить модератора\n' +
          '/delmod &lt;id&gt; — снять модератора\n' +
          '/mods — список модераторов\n' +
          '/notify — вкл/выкл заявки лично мне\n' +
          '/setchannel &lt;@канал&gt; — куда публиковать\n' +
          '/stats — статистика\n' +
          '/ban &lt;номер заявки&gt; — забанить автора\n' +
          '/unban &lt;user_id&gt; — разбанить';
      return send(chat, out, { parse_mode: 'HTML' });
    }

    case '/pending': {
      if (!(await canModerate(uid))) return;
      const s = await stats();
      return send(chat, `Ждут решения: ${s.pending}`);
    }

    case '/addmod': {
      if (!isOwner(uid)) return;
      if (!args[0])
        return send(
          chat,
          'Использование: /addmod &lt;user_id или @username&gt;\n\n' +
            'По @username сработает только если человек уже писал боту.',
          { parse_mode: 'HTML' }
        );
      let target = { user_id: null, username: null, first_name: null };
      if (/^\d+$/.test(args[0])) {
        target.user_id = Number(args[0]);
      } else {
        const found = await findUserByUsername(args[0]);
        if (!found)
          return send(
            chat,
            'Такого пользователя нет в базе. Пусть сначала напишет боту /start, либо укажи его user_id.'
          );
        target = found;
      }
      if (target.user_id === OWNER_ID) return send(chat, 'Ты и так владелец.');
      await sb('moderators', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(target),
      });
      return send(chat, `Модератор добавлен: <code>${target.user_id}</code>`, {
        parse_mode: 'HTML',
      });
    }

    case '/delmod': {
      if (!isOwner(uid)) return;
      if (!/^\d+$/.test(args[0] || ''))
        return send(chat, 'Использование: /delmod &lt;user_id&gt;', { parse_mode: 'HTML' });
      const removed = await sb(`moderators?user_id=eq.${args[0]}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      });
      return send(chat, removed?.length ? 'Модератор снят.' : 'Такого модератора нет.');
    }

    case '/mods': {
      if (!isOwner(uid)) return;
      const mods = await getModerators();
      if (!mods.length)
        return send(chat, 'Модераторов нет. Пока заявки приходят только тебе.');
      const lines = mods.map((m) => {
        const name = m.username ? `@${m.username}` : esc(m.first_name) || 'без имени';
        return `• ${name} — <code>${m.user_id}</code>`;
      });
      return send(chat, `<b>Модераторы:</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
    }

    case '/notify': {
      if (!isOwner(uid)) return;
      const now = await getSetting('owner_notify', '1');
      const next = now === '1' ? '0' : '1';
      await setSetting('owner_notify', next);
      if (next === '1') return send(chat, 'Заявки снова приходят тебе.');
      const mods = await getModerators();
      return send(
        chat,
        mods.length
          ? 'Ок, заявки тебе больше не приходят — только модераторам.'
          : 'Заявки тебе отключены, но модераторов нет — пока их не назначишь, они всё равно будут приходить тебе, чтобы ничего не потерялось.'
      );
    }

    case '/setchannel': {
      if (!isOwner(uid)) return;
      if (!args[0]) {
        const cur = (await getSetting('channel_id')) || 'не задан';
        return send(
          chat,
          `Сейчас канал: <code>${esc(cur)}</code>\n\n` +
            'Использование: /setchannel @mychannel\nБот должен быть админом этого канала.',
          { parse_mode: 'HTML' }
        );
      }
      await setSetting('channel_id', args[0]);
      return send(chat, `Канал установлен: <code>${esc(args[0])}</code>`, {
        parse_mode: 'HTML',
      });
    }

    case '/stats': {
      if (!isOwner(uid)) return;
      const s = await stats();
      const mods = await getModerators();
      const notify = (await getSetting('owner_notify', '1')) === '1' ? 'вкл' : 'выкл';
      const channel = (await getSetting('channel_id')) || 'не задан';
      return send(
        chat,
        '<b>Статистика</b>\n\n' +
          `Пользователей: <b>${s.users}</b>\n` +
          `Ожидают: <b>${s.pending}</b>\n` +
          `Одобрено: <b>${s.approved}</b>\n` +
          `Отклонено: <b>${s.rejected}</b>\n\n` +
          `Модераторов: <b>${mods.length}</b>\n` +
          `Уведомления владельцу: <b>${notify}</b>\n` +
          `Канал: <code>${esc(channel)}</code>`,
        { parse_mode: 'HTML' }
      );
    }

    case '/ban': {
      if (!isOwner(uid)) return;
      if (!/^\d+$/.test(args[0] || ''))
        return send(chat, 'Использование: /ban &lt;номер заявки&gt;', { parse_mode: 'HTML' });
      const sub = await getSubmission(Number(args[0]));
      if (!sub) return send(chat, 'Заявка не найдена.');
      await setBanned(sub.author_id, true);
      return send(chat, `Автор заявки #${args[0]} забанен. Разбан: /unban ${sub.author_id}`);
    }

    case '/unban': {
      if (!isOwner(uid)) return;
      if (!/^\d+$/.test(args[0] || ''))
        return send(chat, 'Использование: /unban &lt;user_id&gt;', { parse_mode: 'HTML' });
      await setBanned(Number(args[0]), false);
      return send(chat, 'Разбанен.');
    }

    default:
      return;
  }
}

// ══════════════════════════════════════════════════════════════
// ПРИЁМ ЗАЯВКИ
// ══════════════════════════════════════════════════════════════

async function handleSubmission(msg) {
  const uid = msg.from.id;
  const chat = msg.chat.id;

  if (await isBanned(uid)) return;

  const data = extract(msg);
  if (!data)
    return send(
      chat,
      'Такой тип сообщений не поддерживается. Можно текст, фото, видео, гиф, голосовое или файл.'
    );

  if ((await countRecent(uid)) >= RATE_LIMIT_MESSAGES) {
    const mins = Math.max(1, Math.round(RATE_LIMIT_WINDOW / 60));
    return send(chat, `Слишком много сообщений подряд. Попробуй через ${mins} мин.`);
  }

  await upsertUser(msg.from);

  const [mediaType, fileId, content] = data;
  const sub = await createSubmission(uid, mediaType, fileId, content);

  // Кому отправлять
  const mods = await getModerators();
  const recipients = mods.map((m) => m.user_id);
  const ownerNotify = (await getSetting('owner_notify', '1')) === '1';
  if ((ownerNotify || recipients.length === 0) && OWNER_ID && !recipients.includes(OWNER_ID)) {
    recipients.push(OWNER_ID);
  }

  const header = `📨 Заявка #${sub.id}`;
  const caption = content ? `${header}\n\n${content}` : header;

  const copies = [];
  for (const rid of recipients) {
    try {
      const sent = await sendMedia(rid, sub, caption, modKeyboard(sub.id));
      copies.push([rid, sent.message_id]);
    } catch (e) {
      console.error(`Заявка #${sub.id} → ${rid}: ${e.message}`);
    }
  }
  await saveCopies(sub.id, copies);

  return send(chat, TEXT_SENT);
}

// ══════════════════════════════════════════════════════════════
// КНОПКИ МОДЕРАЦИИ
// ══════════════════════════════════════════════════════════════

async function handleCallback(cq) {
  const uid = cq.from.id;
  const [action, idStr] = (cq.data || '').split(':');
  const id = Number(idStr);

  const answer = (text, alert = false) =>
    tg('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert });

  if (!(await canModerate(uid))) return answer('Нет прав.', true);

  const existing = await getSubmission(id);
  if (!existing) return answer('Заявка не найдена.', true);

  const status = action === 'ok' ? 'approved' : 'rejected';
  const sub = await claimSubmission(id, status, uid);
  if (!sub) {
    await answer('Эту заявку уже обработали.', true);
    try {
      await tg('editMessageReplyMarkup', {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
      });
    } catch {}
    return;
  }

  const moderator = cq.from.username ? `@${cq.from.username}` : cq.from.first_name || uid;
  let verdict;

  if (status === 'approved') {
    const channel = await getSetting('channel_id');
    if (!channel) {
      await releaseSubmission(id);
      return answer('Канал не задан. Владелец: /setchannel @канал', true);
    }
    try {
      let postCaption = sub.content || '';
      if (POST_SIGNATURE) postCaption = `${postCaption}\n\n${POST_SIGNATURE}`.trim();
      await sendMedia(channel, sub, postCaption || undefined);
    } catch (e) {
      await releaseSubmission(id);
      return answer(`Ошибка публикации: ${e.message}`, true);
    }
    await answer('Опубликовано');
    verdict = '✅ Одобрено';
    try { await send(sub.author_id, TEXT_APPROVED); } catch {}
  } else {
    await answer('Отклонено');
    verdict = '❌ Не одобрено';
    try { await send(sub.author_id, TEXT_REJECTED); } catch {}
  }

  // Убираем кнопки у всех копий и дописываем вердикт
  for (const [chatId, messageId] of sub.copies || []) {
    try {
      await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId });
      await send(chatId, `Заявка #${id}: ${verdict} (${moderator})`, {
        reply_to_message_id: messageId,
      });
    } catch {}
  }
}

// ══════════════════════════════════════════════════════════════
// ТОЧКА ВХОДА
// ══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Проверяем, что стучится действительно Telegram
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let update = req.body;
  if (!update || typeof update === 'string') {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString() || (typeof req.body === 'string' ? req.body : '');
      update = raw ? JSON.parse(raw) : {};
    } catch {
      update = {};
    }
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message && update.message.chat.type === 'private') {
      const msg = update.message;
      const text = msg.text || '';
      if (text.startsWith('/')) {
        const parts = text.split(/\s+/);
        const cmd = parts[0].split('@')[0].toLowerCase();
        await handleCommand(msg, cmd, parts.slice(1));
      } else {
        await handleSubmission(msg);
      }
    }
  } catch (e) {
    console.error('handler error:', e.message);
  }

  // Telegram всегда должен получить 200, иначе будет слать апдейт повторно
  return res.status(200).json({ ok: true });
}
