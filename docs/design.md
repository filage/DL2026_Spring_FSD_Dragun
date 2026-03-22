# Часть 1. Проектирование и анализ

## 1.1. Пользовательские сценарии (user stories)

1) **Поиск мест рядом**

Как пользователь, я хочу увидеть на карте места рядом со мной (кафе, музеи, парки, достопримечательности), чтобы быстро выбрать, куда пойти.

2) **Фильтрация по типам (мультивыбор)**

Как пользователь, я хочу включать/выключать несколько типов мест (например, только кафе и парки), чтобы список соответствовал моим интересам.

3) **Отзывы и сохранение**

Как пользователь, я хочу входить в аккаунт и сохранять понравившиеся места в избранное, отмечать посещения и оставлять отзывы, чтобы вести личную историю и помогать другим.

## 1.2. Функциональные требования

### Обязательные

**Фронтенд**

- Отображение карты и текущего местоположения пользователя.
- Загрузка мест рядом с фиксированным радиусом (3000 м).
- Фильтрация по типам мест (мультивыбор; можно выключить все).
- Просмотр списка мест и карточки выбранного места.
- Построение маршрута до места.
- Регистрация и вход по `username` + `password`.
- Избранное, история посещении, отзывы (доступно после входа).
- Обработка ошибок и состояния загрузки.

**Бэкенд**

- Endpoint для получения мест рядом (интеграция с Overpass API).
- Кеширование и дедупликация запросов к Overpass, чтобы уменьшить задержки.
- Endpoint авторизации (JWT).
- CRUD-операции для избранного/посещении/отзывов.
- Обработка ошибок и корректные JSON-ответы.

### Опциональные

- Роли (USER/ADMIN) и админ-скрипт для создания администратора.
- Расширенные метаданные места (описание, wikipedia, website) при наличии тегов OSM.

## 1.3. Проектирование API

Базовый URL: `http://localhost:5174/api`

### Auth

1) **POST** `/auth/register`

- Body (JSON):

```json
{ "username": "string", "password": "string" }
```

- Response 200:

```json
{ "ok": true, "token": "string", "user": { "id": "string", "username": "string", "role": "USER" } }
```

- Ошибки:
  - 409: `{ "ok": false, "error": "Username already in use" }`

2) **POST** `/auth/login`

- Body (JSON):

```json
{ "username": "string", "password": "string" }
```

- Response 200:

```json
{ "ok": true, "token": "string", "user": { "id": "string", "username": "string", "role": "USER" } }
```

- Ошибки:
  - 401: `{ "ok": false, "error": "Unknown username" }`
  - 401: `{ "ok": false, "error": "Wrong password" }`

3) **GET** `/auth/me`

- Auth: `Authorization: Bearer <token>`
- Response 200:

```json
{ "ok": true, "user": { "id": "string", "username": "string", "role": "USER" } }
```

### Places

1) **GET** `/places/nearby`

- Query:
  - `lat` number
  - `lng` number
  - `radius` number (в приложении фиксирован 3000)
  - `category` enum: `cafe | museum | park | attraction`
  - `limit` number (до 80)

- Response 200:

```json
{
  "ok": true,
  "places": [
    {
      "id": "osm:node/123",
      "name": "string",
      "category": "cafe",
      "coordinates": { "lat": 0, "lng": 0 },
      "distanceMeters": 123,
      "address": "string | null",
      "description": "string | null",
      "wikipedia": "string | null",
      "website": "string | null"
    }
  ]
}
```

2) **GET** `/places/:id`

- Используется для upsert в кеш БД по OSM id (когда пользователь взаимодействует с местом).

### Favorites (требуют авторизации)

1) **GET** `/favorites`
- Response: список избранного.

2) **POST** `/favorites/:placeId`
- Добавить место в избранное.

3) **DELETE** `/favorites/:placeId`
- Удалить из избранного.

### Visits (требуют авторизации)

1) **GET** `/visits`
- Response: история посещении.

2) **POST** `/visits/:placeId`
- Добавить посещение.

3) **DELETE** `/visits/:placeId`
- Удалить посещение.

### Reviews (требуют авторизации на создание/удаление)

1) **GET** `/reviews/:placeId`
- Получить отзывы для места.

2) **POST** `/reviews/:placeId`
- Body: `{ "rating": 1..5, "text": "string" }`

3) **DELETE** `/reviews/:reviewId`
- Удалить свой отзыв.

### Routing

1) **GET** `/route`

- Query: `fromLat, fromLng, toLat, toLng`
- Response: geojson/список координат для линии маршрута.

## 1.4. Модель данных

База: SQLite через Prisma.

### User

- `id: String` (cuid)
- `username: String` (unique)
- `passwordHash: String`
- `role: Role` (`USER | ADMIN`)
- `createdAt: DateTime`

### PlaceCache

- `id: String` (OSM id вида `osm:node/..`)
- `name: String`
- `category: String`
- `lat: Float`
- `lng: Float`
- `address: String?`
- `rawJson: String`
- `fetchedAt: DateTime`
- `lastAccessedAt: DateTime`

### Favorite

- `id: String`
- `userId: String`
- `placeId: String`
- `createdAt: DateTime`
- Unique: `(userId, placeId)`

### Visit

- `id: String`
- `userId: String`
- `placeId: String`
- `visitedAt: DateTime`
- `notes: String?`

### Review

- `id: String`
- `userId: String`
- `placeId: String`
- `rating: Int`
- `text: String`
- `createdAt: DateTime`

## 1.5. Ключевые технические решения

- **Frontend**: SvelteKit + TypeScript
  - Быстрый dev experience, удобная компонентная модель.
- **Карта**: MapLibre GL
  - Открытая альтернатива Mapbox GL, можно использовать публичные стили.
- **Backend**: Express + TypeScript
  - Простая структура для REST API.
- **ORM/DB**: Prisma + SQLite
  - Простая установка, удобно для лабораторной, работает на Windows и Linux.
- **Auth**: JWT
  - Stateless, легко подключается к запросам.
- **Внешние API**:
  - **Overpass API** (OSM) для поиска мест рядом.
  - **OSRM** для построения маршрутов.
- **Производительность**:
  - In-memory кеш + дедупликация in-flight запросов.
  - Бакетизация координат для стабильных ключей кеша.
  - Ограничение параллелизма Overpass-запросов и ретраи при сетевых сбоях.
