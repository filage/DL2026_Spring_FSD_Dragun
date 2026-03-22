# 🗺️ GeoGuide

GeoGuide — веб-приложение с картой, которое показывает интересные места рядом с пользователем.

## ✨ Возможности

- 🔎 Поиск мест рядом (кафе, музеи, парки, достопримечательности)
- 🧩 Фильтры по типам (можно выбрать несколько или выключить все)
- 🧭 Карточка места и маршрут
- ⭐ После входа: избранное, история посещении, отзывы

## 🧰 Технологии

- **Frontend**: SvelteKit + MapLibre GL
- **Backend**: Node.js (Express) + Prisma (SQLite)
- **Внешние API**: Overpass (OSM), OSRM

## 📚 Документация

- `docs/design.md` — часть 1 (проектирование)
- `docs/AI_REFLECTION.md` — часть 3 (рефлексия по AI)

## 🗂️ Структура проекта

```text
.
├── backend/              # API (Express + Prisma)
│   ├── prisma/           # schema.prisma + миграции
│   ├── src/              # роуты, сервисы (overpass/osrm), middleware
│   ├── .env.example
│   └── package.json
├── frontend/             # UI (SvelteKit + MapLibre)
│   ├── src/
│   ├── .env.example
│   └── package.json
├── docs/                 # design.md + AI_REFLECTION.md + images/
├── package.json          # npm workspaces + общие команды
└── package-lock.json
```

## 📦 Установка

> Ниже команды для терминала. Можно использовать Terminal в VS Code.

### 1) Клонировать репозиторий

```bash
git clone https://github.com/filage/DL2026_Spring_FSD_Dragun.git
```

### 2) Перейти в папку проекта

```bash
cd DL2026_Spring_FSD_Dragun
```

### 3) Установить зависимости

```bash
npm install
```

### 4) Настроить переменные окружения

#### Backend (.env)

PowerShell (Windows):

```powershell
Copy-Item backend/.env.example backend/.env
```

Bash (macOS/Linux/Git Bash):

```bash
cp backend/.env.example backend/.env
```

Открой `backend/.env` и заполни минимум:

- `JWT_SECRET` (любой длинный секрет)

#### Frontend (.env) (опционально)

PowerShell (Windows):

```powershell
Copy-Item frontend/.env.example frontend/.env
```

Bash (macOS/Linux/Git Bash):

```bash
cp frontend/.env.example frontend/.env
```

### 5) Prisma: сгенерировать клиент и применить миграции (SQLite)

```bash
npm run prisma:generate -w backend
npm run prisma:migrate -w backend
```

## 🚀 Запуск

### Режим разработки (frontend + backend)

```bash
npm run dev
```

Открой:

- Frontend: http://localhost:5173
- Backend API: http://localhost:5174/api

### Запуск по отдельности

```bash
npm run dev:backend
npm run dev:frontend
```

### Продакшн сборка

```bash
npm run build -w backend
npm run build -w frontend
```

## 🧪 Полезные команды

```bash
npm run check -w frontend
```

## 🛠️ Частые проблемы

1) **`node` / `npm` не находятся**

- Установи Node.js (LTS) с https://nodejs.org/
- Перезапусти VS Code

2) **Prisma ругается на `DATABASE_URL`**

- Проверь, что создан `backend/.env`
- Проверь строку `DATABASE_URL="file:./prisma/dev.db"`

3) **Иногда не грузятся места (Overpass)**

Overpass — внешний сервис OSM и иногда он нестабилен. В проекте есть кеш/ретраи/несколько эндпоинтов, но редкие сбои все равно возможны.
