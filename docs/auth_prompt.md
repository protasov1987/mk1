# Промт для реализации авторизации по паролю

Ниже собрана единая инструкция, как реализовать и настроить авторизацию только по паролю так, чтобы она работала с первого раза. Повторяй описанные шаги буквально.

## UI: верстка и состояния
- В корне `body` держим два основных контейнера:
  - `#login-overlay` с вложенным `#login-modal` и формой `#login-form`, содержащей поле `#login-password`, кнопку `#login-submit` и контейнер ошибки `#login-error`.
  - `#app-root` — весь основной интерфейс приложения.
- Используем класс `.hidden { display: none !important; }` и стартовые состояния: оверлей видимый, `#app-root` скрыт через `hidden`.

Пример разметки:
```html
<div id="login-overlay" class="auth-overlay">
  <div id="login-modal" class="auth-modal">
    <h2>Вход</h2>
    <form id="login-form">
      <input type="password" id="login-password" name="password" placeholder="Пароль" required />
      <button type="submit" id="login-submit">Войти</button>
      <div id="login-error" style="display:none;"></div>
    </form>
  </div>
</div>

<div id="app-root" class="hidden">
  <!-- основной интерфейс -->
</div>
```

## Клиентский JavaScript
- На `DOMContentLoaded` навешиваем обработчик `submit` на `#login-form`.
- При отправке:
  1. Берём пароль из `#login-password`.
  2. Формируем `FormData` с `password`.
  3. Делаем `fetch('/api/login', { method: 'POST', body: formData, credentials: 'include' })`.
  4. Разбираем JSON-ответ.
- При `data.success === true`:
  - Добавляем `hidden` к `#login-overlay` и убираем `hidden` у `#app-root`.
  - Сбрасываем текст ошибки.
  - Сохраняем данные пользователя, обновляем бейдж пользователя и вызываем `loadInitialData()`/`bootstrapApp()` для загрузки интерфейса.
- При ошибке:
  - Показываем `#login-error` с текстом из `data.error` или дефолтным «Неверный пароль».
- При падении сети показываем «Ошибка соединения с сервером».
- Не делаем защищённые запросы до успешного логина. После авторизации используем `credentials: 'include'` для всех API-вызовов.
- Повторный показ логина допускается только при реальном 401 от API, но не должен срабатывать сразу после успешного входа.

## Серверная часть
- Публичные API-маршруты: `/api/login`, `/api/logout`, `/api/session` (и статика) пропускаем без проверки сессии.
- Все остальные API под `/api/data` защищены: если нет валидной сессии, отвечаем `401 {"error":"Unauthorized"}`.
- `POST /api/login`:
  - Принимает пароль в JSON, `application/x-www-form-urlencoded` или `multipart/form-data` (парсим поле `password`).
  - Ищет пользователя, сверяет пароль через PBKDF2-хэш (либо существующий `passwordHash/passwordSalt`).
  - При успехе создаёт сессионный токен (cookie `session`, HttpOnly, SameSite=Lax) и возвращает `{"success": true, "user": "Abyss"}`.
  - При неверном пароле — `401 {"success": false, "error": "Неверный пароль"}`.
- `GET /api/session` возвращает данные пользователя, либо `401 Unauthorized` без сброса страницы.
- `POST /api/logout` удаляет сессию и обнуляет cookie.

## Данные и дефолтный пользователь
- В БД (`database.json`) храним массив `users` с полями `id`, `name`, `role`, `passwordHash`, `passwordSalt`.
- При старте, если `users` пустой, создаём пользователя `Abyss` с ролью `admin` и паролем `ssyba`, хэшированным через PBKDF2. Если у `Abyss` или других записей нет хэша, он пересоздаётся из исходного пароля, при этом роль `admin` сохраняется и пароль `ssyba` неизменяем.
- Верификация пароля делается только по хэшу; поле `password` не храним и не используем после миграции.

## Поведение после входа
- Успешный ответ `success:true` гарантированно скрывает оверлей и показывает приложение до конца сессии.
- Все дальнейшие API-запросы выполняются с сессионной cookie. При истечении сессии фронт может снова показать форму логина после получения 401.

Скопируй и следуй этому промту при следующих задачах по авторизации, чтобы избежать регрессий.
