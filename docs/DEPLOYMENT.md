# Развёртывание интеграций

Этот файл предназначен для сопровождающего. Пользователю достаточно пройти две видимые авторизации: начать чат с Telegram-ботом по коду из приложения и дать Google Calendar согласие.

## Ресурсы

- Cloudflare Worker/Sites с D1 binding `DB`;
- Cron Trigger `* * * * *`;
- Telegram-бот;
- Google Cloud OAuth Client типа Web application;
- выбранный OpenAI-совместимый провайдер расшифровки и планирования.

## Секреты

Все переменные перечислены в `.env.example`. В production задаются через защищённые настройки хостинга. Обязательные секреты: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`. Для Google нужны `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`. Для голоса нужны `AI_API_KEY`, `AI_MODEL`, `TRANSCRIPTION_MODEL`; стоимость и бесплатные квоты зависят от выбранного провайдера.

`TOKEN_ENCRYPTION_KEY` — ровно 32 случайных байта в base64. Никогда не менять его без процедуры повторного подключения Google: старые токены перестанут расшифровываться.

## Google Cloud

1. Включить Google Calendar API.
2. Настроить OAuth consent screen.
3. Создать Web application OAuth client.
4. Добавить точный redirect URI `https://<backend>/api/google/callback`.
5. Сохранить client ID/secret в защищённой среде и установить `GOOGLE_REDIRECT_URI`.

Приложение запрашивает `calendar.events.owned` и программно ограничивает работу собственными отображениями событий.

## Telegram

После публикации вызвать `POST /api/admin/telegram/setup` с `Authorization: Bearer <CRON_SECRET>`. Endpoint устанавливает HTTPS webhook, секретный заголовок и команды бота. Не помещать секрет в workflow-файлы или URL.

Для семейного режима `TELEGRAM_ALLOWED_CHAT_ID` оставляют пустым. Публичный адрес не раскрывает чужие записи: серверные действия требуют токен связанного устройства, а строки календаря, напоминаний и дней рождения дополнительно ограничены `device_id`.

Если платформа не применяет Cron Trigger из Worker-конфигурации, добавить `* * * * *` вручную в панели Cloudflare. Все cron-выражения Cloudflare выполняются в UTC, но день рождения вычисляется в сохранённом часовом поясе.

## Миграция

Схема и последовательные обновления находятся в `drizzle/*.sql`. Они не содержат пользовательских данных или секретов.
