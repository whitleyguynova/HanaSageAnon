-- ============================================================
-- AnonBot — схема базы для Supabase
-- Выполнить один раз: Supabase → SQL Editor → вставить → Run
-- ============================================================

create table if not exists users (
  user_id     bigint primary key,
  username    text,
  first_name  text,
  is_banned   boolean     not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists moderators (
  user_id     bigint primary key,
  username    text,
  first_name  text,
  added_at    timestamptz not null default now()
);

create table if not exists submissions (
  id          bigserial primary key,
  author_id   bigint not null,
  media_type  text   not null,              -- text|photo|video|animation|voice|video_note|audio|document
  file_id     text,
  content     text,                         -- текст сообщения или подпись к медиа
  status      text   not null default 'pending',   -- pending|approved|rejected
  decided_by  bigint,
  copies      jsonb  not null default '[]'::jsonb, -- [[chat_id, message_id], ...]
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create index if not exists submissions_author_created_idx on submissions (author_id, created_at desc);
create index if not exists submissions_status_idx         on submissions (status);

create table if not exists settings (
  key    text primary key,
  value  text
);

insert into settings (key, value) values ('owner_notify', '1') on conflict (key) do nothing;
insert into settings (key, value) values ('channel_id',   '') on conflict (key) do nothing;

-- Включаем RLS: публичный anon-ключ не получит доступ к данным.
-- Бот ходит через service_role, который RLS обходит.
alter table users       enable row level security;
alter table moderators  enable row level security;
alter table submissions enable row level security;
alter table settings    enable row level security;
