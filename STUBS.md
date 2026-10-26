# Заглушки запросов

Фронтенд работает без сервера. Все запросы к REST API и оба WebSocket обрабатывает заглушка в самом браузере, в сеть ничего не уходит. Контракт, под который написаны запросы, описан в [docs/api.md](docs/api.md). Здесь описано, что отвечает заглушка на каждый запрос.

Камера и микрофон на экране «Веб-камера» настоящие (`getUserMedia`). Кадры и звук передаются в заглушку и не покидают браузер.

## Где лежат заглушки

| Файл | Что делает |
|---|---|
| `src/api/index.ts` | Единая точка доступа к данным. Все члены `api` и функции `fetchHealth`, `fetchSessions`, `deleteSession`, `exportUrl` берутся из `./stub`. |
| `src/api/stub/index.ts` | Сервер в памяти: все REST-вызовы и `/ws/streams`. |
| `src/api/stub/live.ts` | Поддельный сокет `/ws/live` (`openLiveSocket`). Его создаёт `src/live/run.ts`. |
| `src/api/stub/sim.ts` | Симуляция: лица на камерах, вероятности эмоций, правило событий. |
| `src/api/stub/data.ts` | Демо-данные: 8 камер на 3 точках, 5 файлов, 2 прошлых сеанса веб-камеры, ответ `/api/health`. Адреса камер взяты из диапазона `192.0.2.0/24`, он зарезервирован для документации. |
| `src/api/stub/stub.test.ts` | Тесты заглушек. |

Клиенты для настоящего сервера тоже есть в коде: `src/api/real.ts` (REST) и `src/api/streamsSocket.ts` (`/ws/streams`). У них свои тесты. В сборку они не попадают, потому что их никто не импортирует. Как их подключить, описано в разделе [«Подключение сервера»](#подключение-сервера).

Состояние заглушки живёт до перезагрузки страницы. Ответ приходит примерно через 150 мс. Заглушка возвращает копию данных (`structuredClone`), как будто они пришли по сети.

## Правило событий в симуляции

Камеры, файлы и веб-камера создают события по одному правилу. Пороги берутся из текущих настроек (`GET /api/settings`).

- Лицо меньше `min_face_px` камеры или трек моложе 1 с: решение `abstain`, событий нет.
- Сумма вероятностей выбранных негативных эмоций не ниже `negative_threshold`: решение `watch`. Если это держится `min_duration_s`, создаётся негативное событие со статусом `new`, а решение становится `alert`. Следующее негативное событие для того же трека возможно не раньше чем через `cooldown_s`.
- Вероятность радости не ниже `positive_threshold` в течение `min_duration_s`: позитивное событие (`state: null`) и решение `positive`. Пауза между позитивными событиями тоже `cooldown_s`.
- В остальных случаях решение `none`.

## REST

| Метод и путь | Функция | Где вызывается | Что отвечает заглушка |
|---|---|---|---|
| `GET /api/health` | `fetchHealth` | `shell/context.tsx`: опрос раз в 5 с, баннер под шапкой, «Настройки › Система» | `status: "ok"`, `device: "cuda"`, все четыре модели `true`, `gpu_name: "NVIDIA GeForce RTX 3050 Laptop GPU"`. |
| `GET /api/sessions` | `fetchSessions` | `sessions/SessionsView.tsx` («История › Сеансы и экспорт») | Сеансы веб-камеры (2 демо плюс созданные на экране «Веб-камера»), сеанс `rtsp` для каждой камеры, у которой есть сессия, и все файлы. Сортировка от новых к старым. |
| `DELETE /api/sessions/{id}` | `deleteSession` | «История › Сеансы и экспорт» | Удаляет сеанс, его события и таймлайн. Для статусов `running`, `queued`, `processing` возвращает ошибку «Сессия ещё идёт». Для неизвестного id — «Сессия не найдена». |
| `GET /api/sessions/{id}/export?format=csv\|json` | `exportUrl`, `api.fileExportUrl` | ссылки CSV/JSON в «Сеансах», «Экспорт» в результате анализа файла | Ссылка `data:` (не `blob:`), освобождать её не нужно. Колонки описаны в [docs/api.md](docs/api.md#экспорт-сеанса). Строки есть только у файлов с готовым таймлайном (лица и голос). У остальных сеансов файл содержит только заголовок. |
| `GET /api/streams` | `api.listStreams` | `state/appData.ts`: сетка потоков, боковая панель, экран потока, «Настройки › Камеры» | 8 камер: 6 в состоянии `running`, одна `connecting`, одна `error`. |
| `POST /api/streams` | `api.createStream` | `streams/AddStreamDialog.tsx` | Проверяет, что название не пустое, а адрес начинается с `rtsp://`. Иначе ошибка «Укажите название и адрес вида rtsp://…». Новая камера сразу получает `connecting`, а через 2,5 с — `running` и сессию `rtsp`. |
| `PATCH /api/streams/{id}` | `api.updateStream` | `settings/CamerasTab.tsx` | Объединяет поля и `settings`. Если `enabled: false`, камера переходит в `stopped`. При повторном включении — снова `running`. |
| `DELETE /api/streams/{id}` | `api.deleteStream` | «Настройки › Камеры» | Удаляет камеру и рассылает `stream_status: stopped`. |
| `POST /api/streams/{id}/reconnect` | `api.reconnectStream` | `streams/StreamDetail.tsx` | Переводит камеру в `reconnecting`, через 3 с — в `error` с текстом «Источник не отвечает (заглушка)». Если анализ камеры выключен, возвращает ошибку «Анализ этой камеры выключен». |
| `POST /api/streams/test` | `api.testStream` | «Добавить поток» › «Проверить» | Адрес не `rtsp://`: `ok: false`. Адрес содержит `unreachable` или `0.0.0.0`: «Нет ответа от камеры». Остальные адреса: `ok: true`, 1920×1080, со звуком. |
| `GET /api/streams/{id}/log?interval_s=&limit=` | `api.fetchStreamLog` | журнал на экране потока | До 12 случайных интервалов. Для камеры не в `running` — пустой список. |
| `GET /api/system` | `api.fetchSystem` | экраны не вызывают (нагрузка приходит через `/ws/streams`) | Случайные CPU, RAM, GPU и VRAM. |
| `GET /api/events?...` | `api.listEvents` | колокольчик (`appData`), «История › Журнал событий», результат анализа файла | Все фильтры и постраничная выдача через `before_id`. В журнале 6 стартовых событий, одно из них новый инцидент на камере «Ресепшн». Новые события создают симуляция камер, анализ файлов и сеансы веб-камеры. |
| `POST /api/events/{id}/ack` | `api.ackEvent` (через `appData.ack`) | колокольчик, баннер на экране потока, «Журнал событий» | Записывает `confirmed` или `false_alarm` и рассылает событие в `/ws/streams`. Для позитивного события — «Подтверждать можно только негативные события». Для неизвестного id — «Событие не найдено». |
| `GET /api/events/export?...&format=` | `api.exportEvents` | «Журнал событий» › «Экспорт» | Ссылка `data:` с отфильтрованным журналом без постраничного деления. Имя файла `events.csv` или `events.json`. |
| `GET /api/settings` | `api.fetchSettings` | `settings/SettingsPage.tsx`, интервал журнала на экране потока | Настройки в памяти, по умолчанию `DEFAULT_SETTINGS`. |
| `PUT /api/settings` | `api.saveSettings` | «Настройки › События», «Настройки › Журнал» | Сохраняет настройки в памяти. Пороги и длительности сразу влияют на правило событий в симуляции. |
| `GET /api/sessions?kind=file` | `api.listFileSessions` | `analyze/AnalyzePage.tsx` (опрос 1 с или 10 с), имена файлов в «Журнале событий» | 5 демо-файлов: готовый, в обработке, в очереди, готовый без звука, с ошибкой. Затем загруженные файлы. |
| `GET /api/sessions/{id}` | `api.fetchFileSession` | экраны не вызывают (клиент сервера вызывает его внутри `uploadFile`) | Файл по id или «Сессия не найдена». |
| `POST /api/files` | `api.uploadFile` | «Анализ видео» › «Выбрать файлы» или перетаскивание | Файл никуда не отправляется. Прогресс 25, 50, 75 и 100 % с шагом 150 мс. Браузер читает длительность и разрешение ролика. Файл встаёт в очередь, обработка идёт 10 % в секунду, затем генерируется результат. |
| `GET /api/sessions/{id}/timeline` | `api.fetchTimeline` | результат анализа файла | Кадры с частотой 5 к/с (лица, рамки, решения) и голосовые окна раз в секунду. До окончания обработки — «Результат ещё не готов». |
| `GET /api/sessions/{id}/media` | `api.fileMediaUrl` | плеер в результате анализа | Загруженный файл: `blob:` URL локального файла, видео играет, рамки рисуются поверх. У демо-файлов видео нет: пустой `data:` URL и пометка `playback_unavailable`, поэтому плеер показывает «Браузер не может воспроизвести этот формат». Рамки, график и шкала времени при этом работают. |

## WebSocket

| Канал | Функция | Где используется | Что делает заглушка |
|---|---|---|---|
| `/ws/streams` | `api.connectStreams` | `state/appData.ts`: все экраны потоков, колокольчик, строка нагрузки | Сразу вызывает `onConnection({ type: "open", first: true })` и рассылает `stream_status` всех камер. Каждые 200 мс отправляет `stream_result` для каждой камеры в `running`. Сообщение `event` отправляется при новом событии и при подтверждении. Сообщение `system` отправляется раз в секунду. Бинарные кадры: раз в секунду на каждую камеру рисуется синтетический JPEG на canvas (фон, силуэты в местах лиц, название камеры и время). Обрыв и переподключение не симулируются. |
| `/ws/live` | `openLiveSocket` (`src/api/stub/live.ts`) | `live/run.ts`, экран «Веб-камера» | Открывается через 100 мс. На `start` отвечает `session` и создаёт сеанс `live`. На каждый кадр (0x01) через 40–60 мс приходит `frame_result` с одним лицом, рамка строится по размеру JPEG из заголовка SOF. Аудио (0x02) включает блок `audio`: речь определяется по громкости (RMS > 600), окно действует 2 с. `fused` смешивает лицо и голос в пропорции 0,7 и 0,3, пока есть речь. Решения и события идут через то же правило, события попадают в журнал и колокольчик. `stop` и `close` завершают сеанс. |

## Ограничения

- Данные случайные. Вероятности эмоций не связаны с изображением. На экране «Веб-камера» рамка не следует за лицом.
- Ошибки сервера (нет связи, 5xx, загрузка моделей) не симулируются. Чтобы проверить такое состояние, верните `fail("текст")` из нужной функции в `src/api/stub/index.ts`. Например, `fetchHealth` с ошибкой показывает баннер «Сервер недоступен».
- `__resetStub()` возвращает заглушку в исходное состояние. Эта функция нужна только тестам.

## Подключение сервера

Когда появится сервер с API из [docs/api.md](docs/api.md), заглушку можно отключить.

1. В `src/api/index.ts` замените импорт заглушки на клиенты сервера:

   ```ts
   import * as real from "./real";
   import { connectStreamsSocket } from "./streamsSocket";

   export * from "./types";
   export { deleteSession, exportUrl, fetchHealth, fetchSessions } from "./real";

   export const api = {
     listStreams: real.listStreams,
     createStream: real.createStream,
     updateStream: real.updateStream,
     deleteStream: real.deleteStream,
     reconnectStream: real.reconnectStream,
     testStream: real.testStream,
     connectStreams: connectStreamsSocket,
     fetchSystem: real.fetchSystem,
     fetchStreamLog: real.fetchStreamLog,
     listEvents: real.listEvents,
     ackEvent: real.ackEvent,
     exportEvents: real.exportEvents,
     fetchSettings: real.fetchSettings,
     saveSettings: real.saveSettings,
     listFileSessions: real.listFileSessions,
     fetchFileSession: real.fetchFileSession,
     uploadFile: real.uploadFile,
     fetchTimeline: real.fetchTimeline,
     fileMediaUrl: real.mediaUrl,
     fileExportUrl: real.exportUrl,
   };
   ```

2. В `src/live/run.ts` создайте настоящий сокет вместо `openLiveSocket()` и верните полю тип `WebSocket`:

   ```ts
   private ws: WebSocket;
   // ...
   const proto = location.protocol === "https:" ? "wss:" : "ws:";
   this.ws = new WebSocket(`${proto}//${location.host}/ws/live`);
   ```

3. Добавьте в `vite.config.ts` прокси для `npm run dev` (порт сервера замените на свой):

   ```ts
   server: {
     proxy: {
       "/api": "http://localhost:8000",
       "/ws": { target: "ws://localhost:8000", ws: true },
     },
   },
   ```

4. Добавьте в `nginx.conf` проксирование `/api/` и `/ws/` на сервер. Для `/ws/` нужны заголовки `Upgrade` и `Connection`. Для загрузки файлов поднимите `client_max_body_size` до `2g`.

5. В `src/sessions/SessionsView.test.tsx` верните ожидание ссылок `/api/sessions/{id}/export?format=…` вместо `data:`.

Сборка проверяет, что в бандле нет внешних адресов. Ссылки `http://localhost:8000` из `vite.config.ts` в бандл не попадают, потому что прокси работает только в `npm run dev`.
