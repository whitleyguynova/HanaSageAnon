# 📨 AnonBot

![Node](https://img.shields.io/badge/Node-18%2B-green?logo=node.js)
![Vercel](https://img.shields.io/badge/Hosting-Vercel-black?logo=vercel)
![Supabase](https://img.shields.io/badge/DB-Supabase-3ECF8E?logo=supabase)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

Анонимная предложка для Telegram-канала. Любой пишет боту — модератор видит заявку с кнопками «Одобрено / Не одобрено». Одобренное улетает в канал, автору приходит уведомление.

Работает 24/7 без своего сервера: webhook на Vercel, данные в Supabase.

---

## ⚙️ Технологии

| Компонент | Технология |
|---|---|
| Среда | Node.js 18+, ESM |
| Хостинг | Vercel Serverless Functions |
| База | Supabase (PostgreSQL + REST) |
| Telegram | Bot API через webhook |
| Зависимости | нет — только fetch |

---

## 🚀 Возможности

- Принимает текст, фото, видео, гиф, голосовые, кружки и файлы
- Заявка уходит всем модераторам сразу; кто нажал первым — тот и решил, у остальных кнопки гаснут
- Одобрено → публикация в канал + уведомление автору
- Не одобрено → автору приходит только уведомление, без причины
- Модераторы назначаются прямо из бота, без правки кода
- Владелец может отключить приход заявок себе, оставив их модераторам
- Антиспам: лимит заявок от одного человека за час
- Бан по номеру заявки — модераторы не видят, кто автор

### Команды

| Команда | Кто | Что делает |
|---|---|---|
| `/start` | все | приветствие |
| `/help` | все | список команд |
| `/pending` | модератор | сколько заявок ждёт |
| `/addmod <id\|@username>` | владелец | назначить модератора |
| `/delmod <id>` | владелец | снять модератора |
| `/mods` | владелец | список модераторов |
| `/notify` | владелец | вкл/выкл заявки лично себе |
| `/setchannel <@канал>` | владелец | сменить канал |
| `/stats` | владелец | статистика |
| `/ban <номер заявки>` | владелец | забанить автора |
| `/unban <user_id>` | владелец | разбанить |

---

## 🛠 Установка

### 1. База данных

Supabase → **SQL Editor** → вставить содержимое `schema.sql` → **Run**.

Затем **Settings → API**: оттуда понадобятся `Project URL` и ключ `service_role`.

### 2. Деплой

Vercel → **Add New Project** → выбрать этот репозиторий → **Deploy**.

### 3. Переменные окружения

Vercel → **Settings → Environment Variables**:

| Переменная | Значение |
|---|---|
| `BOT_TOKEN` | токен от [@BotFather](https://t.me/BotFather) |
| `OWNER_ID` | свой Telegram ID ([@userinfobot](https://t.me/userinfobot)) |
| `WEBHOOK_SECRET` | любая длинная строка, придуманная самостоятельно |
| `SUPABASE_URL` | Project URL из Supabase |
| `SUPABASE_SERVICE_KEY` | ключ `service_role` |
| `POST_SIGNATURE` | подпись под постами (можно пустую) |

После добавления — **Deployments → … → Redeploy**.

### 4. Подключение вебхука

Открыть в браузере один раз:

```
https://ТВОЙ-ПРОЕКТ.vercel.app/api/setup?secret=ЗНАЧЕНИЕ_WEBHOOK_SECRET
```

Ответ с `"ok": true` означает, что Telegram теперь шлёт апдейты на Vercel.

Проверка состояния: `?action=info` · отключить: `?action=delete`

### 5. Канал

Добавить бота в канал администратором с правом публикации, затем в чате с ботом:

```
/setchannel @mychannel
```

---

## 📁 Структура

```
anonbot/
├── api/
│   ├── webhook.js   # вся логика: команды, приём заявок, модерация
│   └── setup.js     # разовая регистрация вебхука
├── schema.sql       # таблицы для Supabase
├── vercel.json      # конфиг функций
├── package.json
└── .env.example     # список переменных
```

---

## 🔐 Безопасность

- `WEBHOOK_SECRET` подписывает запросы — посторонний POST на `/api/webhook` получит 401
- Ключ `service_role` живёт только в переменных Vercel и в репозиторий не попадает
- На всех таблицах включён RLS, поэтому публичный `anon`-ключ к данным не даёт доступа

---

## 👤 Автор

**Танцура Кирилл** — студент экономического факультета МГУ

[![GitHub](https://img.shields.io/badge/GitHub-Exitpacultivate-black?logo=github)](https://github.com/Exitpacultivate)
