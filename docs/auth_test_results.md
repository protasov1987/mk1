# Результаты ручного тестирования авторизации

Дата: 2025-12-03T22:02:55+00:00

## Проведённые проверки
- Запрос `/api/me` без сессии возвращает `401 Unauthorized` с ошибкой `Unauthorized`. См. `curl -i http://localhost:8000/api/me`.
- Запрос `/api/data` без токена возвращает `401 Unauthorized`, данные не отдаются.
- Вход с неверным паролем (`wrong`) отклоняется с `401` и сообщением `"Неверный пароль"`.
- Вход с паролем администратора `ssyba` проходит успешно, сервер отдаёт токен с данными пользователя и уровня доступа.
- Запрос `/api/me` с выданным токеном возвращает информацию о пользователе и уровне доступа (статус `200`).
- Запрос `/api/users` с токеном администратора возвращает список пользователей (проверка выдачи списка и доступа к меню пользователей).
- Создание пользователя с коротким паролем (`abc`) отклоняется с `400` и ошибкой `"Некорректные имя или пароль"`.
- Создание пользователя с валидным паролем (`test12`) проходит успешно; пользователь добавляется в список.
- Повторная попытка создать пользователя с тем же паролем `test12` возвращает `400` и ошибку `"Пароль уже используется"` (проверка уникальности пароля).
- Запрос `/api/logout` завершает сессию (ответ `200` и `status: ok`).
- Запрос `/api/me` после выхода без нового логина возвращает `401 Unauthorized`.

## Использованные команды
Сервер запущен локально командой `npm start`.

Основные HTTP запросы выполнялись через `curl`:
- `curl -i http://localhost:8000/api/me`
- `curl -i http://localhost:8000/api/data`
- `curl -i -X POST http://localhost:8000/api/login -H 'Content-Type: application/json' -d '{"password":"wrong"}'`
- `curl -i -X POST http://localhost:8000/api/login -H 'Content-Type: application/json' -d '{"password":"ssyba"}'`
- `curl -i http://localhost:8000/api/me -H 'x-session-token: <token>'`
- `curl -i http://localhost:8000/api/users -H 'x-session-token: <token>'`
- `curl -i -X POST http://localhost:8000/api/users -H 'Content-Type: application/json' -H 'x-session-token: <token>' -d '{"name":"Тест","password":"abc","accessLevelId":"<admin-level-id>"}'`
- `curl -i -X POST http://localhost:8000/api/users -H 'Content-Type: application/json' -H 'x-session-token: <token>' -d '{"name":"Тестовый","password":"test12","accessLevelId":"<admin-level-id>"}'`
- `curl -i -X POST http://localhost:8000/api/users -H 'Content-Type: application/json' -H 'x-session-token: <token>' -d '{"name":"Повтор","password":"test12","accessLevelId":"<admin-level-id>"}'`
- `curl -i -X POST http://localhost:8000/api/logout -H 'x-session-token: <token>'`
- `curl -i http://localhost:8000/api/me -H 'x-session-token: <token>'`
