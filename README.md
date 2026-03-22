# GeoGuide

GeoGuide — веб-приложение с картой, которое показывает интересные места рядом с пользователем.

Что умеет:

- искать места рядом (кафе, музеи, парки, достопримечательности);
- фильтровать типы мест (можно выбрать несколько или выключить все);
- открывать карточку места, строить маршрут;
- после входа: избранное, история посещении, отзывы.

Стек:

- **Frontend**: SvelteKit + MapLibre GL
- **Backend**: Node.js (Express) + Prisma (SQLite)
- **Внешние API**: Overpass (OSM) для поиска мест, OSRM для маршрутов

## Документация

- `docs/design.md` — часть 1 (проектирование)
- `docs/AI_REFLECTION.md` — часть 3 (рефлексия по AI)

## Быстрый старт (если ты только поставил VS Code)

Ниже инструкция максимально "с нуля".

### 1) Установи нужные программы

1. **VS Code**

Скачать: https://code.visualstudio.com/

2. **Node.js (LTS)**

Скачать: https://nodejs.org/

После установки проверь в терминале:

```bash
node -v
npm -v
```

3. **Git**

Скачать: https://git-scm.com/

Проверка:

```bash
git --version
```

### 2) Склонируй проект и открой в VS Code

1. На GitHub нажми **Code** -> **HTTPS** и скопируй ссылку.
2. Открой VS Code.
3. Открой терминал в VS Code:

`Terminal` -> `New Terminal`

4. В терминале выполни:

```bash
git clone <ССЫЛКА_НА_РЕПОЗИТОРИИ>
cd DL2026_Spring_FSD_Dragun
code .
```

Если проект уже открыт, `code .` не нужен.

### 3) Установи зависимости

В терминале VS Code, из корня проекта:

```bash
npm install
```

### 4) Настрой переменные окружения

#### Backend

1. Открой папку `backend`
2. Скопируй файл `backend/.env.example` и переименуй копию в `backend/.env`
3. Заполни минимум:

- `JWT_SECRET` — любая длинная строка (например 30+ символов)

Остальное можно оставить как в примере:

- `DATABASE_URL="file:./prisma/dev.db"`
- `PORT=5174`

#### Frontend (опционально)

1. Скопируй `frontend/.env.example` в `frontend/.env`
2. Обычно можно не менять, но если нужно:

- `PUBLIC_API_BASE_URL=http://localhost:5174/api`

### 5) Подними базу данных (Prisma)

Из корня проекта:

```bash
npm run prisma:migrate -w backend
npm run prisma:generate -w backend
```

Это создаст SQLite БД и сгенерирует Prisma Client.

### 6) Запусти проект

Запуск фронтенда и бэкенда вместе:

```bash
npm run dev
```

Открой в браузере:

- Frontend: http://localhost:5173
- Backend API: http://localhost:5174/api

## Полезные команды

- Проверка фронтенда (типы/сборка Svelte):

```bash
npm run check -w frontend
```

- Сборка бэкенда (TypeScript):

```bash
npm run build -w backend
```

## Частые проблемы

1) **`npm install` не работает / нет команды `node`**

- Проверь, что Node.js установлен.
- Перезапусти VS Code (иногда PATH обновляется только после перезапуска).

2) **Prisma ругается на `DATABASE_URL`**

- Проверь, что у тебя есть файл `backend/.env`.
- Проверь строку `DATABASE_URL="file:./prisma/dev.db"`.

3) **Не грузятся места и в консоли Overpass ошибки**

Overpass — внешний сервис OSM, иногда работает нестабильно. В проекте добавлены ретраи, несколько эндпоинтов и кеш, но редкие сбои все равно возможны.
