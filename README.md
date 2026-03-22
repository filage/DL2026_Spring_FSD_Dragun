# GeoGuide (DL2026 Spring FSD Lab)

Веб-приложение для поиска интересных мест рядом с пользователем на карте: кафе, музеи, парки и достопримечательности. Есть регистрация/вход, избранное, история посещении и отзывы.

- Фронтенд: SvelteKit + MapLibre GL
- Бэкенд: Node.js (Express) + Prisma (SQLite)
- Внешние API: Overpass (OSM) для поиска мест, OSRM для построения маршрута

## Ссылки на документацию

- `docs/design.md` — часть 1 (проектирование и анализ)
- `docs/AI_REFLECTION.md` — часть 3 (рефлексия по использованию AI)

## Требования

- Node.js 18+ (рекомендуется 20+)
- npm 9+

Проект использует npm workspaces (`/frontend` и `/backend`).

## Установка

```bash
npm install
```

## Настройка окружения

### Backend

Скопируй `backend/.env.example` в `backend/.env` и заполни переменные:

- `JWT_SECRET` — секрет для подписи JWT
- `DATABASE_URL` — путь к SQLite (можно оставить как в примере)
- `PORT` — порт API (по умолчанию `5174`)
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` — для создания администратора (опционально)

### Frontend

Скопируй `frontend/.env.example` в `frontend/.env` (опционально).

- `PUBLIC_API_BASE_URL` — базовый URL бэкенда, по умолчанию `http://localhost:5174/api`

## База данных (Prisma)

Из папки проекта:

```bash
npm run prisma:migrate -w backend
npm run prisma:generate -w backend
```

(Команда миграции создаст/обновит SQLite БД.)

## Запуск (dev)

Запустить фронтенд и бэкенд одновременно:

```bash
npm run dev
```

Или по отдельности:

```bash
npm run dev:backend
npm run dev:frontend
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5174/api

## Полезные команды

- Проверка типов фронтенда:

```bash
npm run check -w frontend
```

- Сборка бэкенда:

```bash
npm run build -w backend
```
