# API сервера

Это контракт, под который написан фронтенд: REST, два WebSocket и формат экспорта. Типы в `src/api/types.ts` и `src/live/protocol.ts` повторяют этот документ. Сейчас все запросы обрабатывает заглушка, её поведение описано в [STUBS.md](../STUBS.md).

## Общие правила

- Фронтенд обращается к серверу по относительным путям `/api/...` и `/ws/...`, то есть к тому же хосту, с которого загружена страница.
- Время всегда в миллисекундах. У потоков и веб-камеры это epoch ms. У событий и таймлайна файла это миллисекунды от начала записи. Фронтенд различает их по величине: значение меньше `1e11` считается временем внутри записи (`isMediaTime` в `src/ui/format.ts`).
- Эмоций всегда семь, ключи одни и те же: `anger, disgust, fear, happiness, sadness, surprise, neutral`. Объект вероятностей (`Probs`) содержит все семь ключей.
- Ошибка — это HTTP 4xx или 5xx с телом `{"detail": "текст"}`. Фронтенд показывает `detail` пользователю как есть, поэтому текст должен быть на русском. Без `detail` фронтенд показывает `HTTP <код>`.
- Тайм-ауты клиента: `GET /api/health` — 4 с, `GET /api/sessions/{id}/timeline` — 30 с, остальные запросы — 8 с. Загрузка файла без тайм-аута.

### Решение по лицу (`decision`)

| Значение | Подпись в интерфейсе | Смысл |
|---|---|---|
| `alert` | Инцидент | Открыто негативное событие. |
| `watch` | Наблюдение | Негатив выше порога, но ещё не держится нужное время. |
| `abstain` | Не уверена | Лицо слишком мелкое или трек слишком новый, оценке не доверяем. |
| `positive` | Позитив | Радость выше порога. |
| `none` | Норма | Ничего из перечисленного. |

Если на кадре несколько лиц, интерфейс показывает самое тяжёлое решение в порядке `alert > watch > abstain > positive > none`.

## Объекты

### Лицо

Одинаковое в `/ws/live`, `/ws/streams` и таймлайне.

```json
{"track_id": 1, "box": [x, y, w, h],
 "face": {"anger": 0.02, "...": 0}, "face_label": "happiness",
 "fused": {"anger": 0.01, "...": 0}, "fused_label": "happiness",
 "confidence": 0.81, "decision": "none", "face_px": 112}
```

- `box` задан в пикселях того изображения, к которому относится результат: отправленного JPEG для веб-камеры, кадра анализа для потока и файла.
- `face` — оценка по лицу, `fused` — итог по лицу и голосу. Без речи `fused` равен `face`.
- `face_px` — ширина лица в пикселях кадра, на котором работал детектор. Интерфейс сравнивает её медиану с `min_face_px` камеры.
- Вероятность негатива на рамке — сумма `anger + sadness + fear + disgust` из `fused`.

### Голосовой блок

```json
{"speech": true, "probs": {"anger": 0.1, "disgust": 0, "fear": 0, "happiness": 0.25, "sadness": 0.05, "surprise": 0, "neutral": 0.6},
 "label": "neutral", "window_end_ts": 1727780000123.4}
```

В тишине `speech: false`, все `probs` равны 0, `label: null`. Если в `/ws/live` блок пришёл повреждённым, фронтенд игнорирует только его, а результат кадра использует.

### Поток (`Stream`)

```json
{"id": "cam1", "name": "Ресепшн", "site": "Тверская", "url": "rtsp://192.0.2.22:554/main",
 "camera_type": "sector",
 "settings": {"enabled": true, "analysis_fps": 5, "detection_size": "auto", "min_face_px": 48},
 "state": "running", "fps": 4.9, "has_audio": true, "source_resolution": [3840, 2160],
 "decode": "nvdec", "session_id": "rtsp-cam1"}
```

| Поле | Значения |
|---|---|
| `camera_type` | `webcam` (веб-камера, поиск лиц 640 px), `sector` (секторная, 1920 px), `security` (купольная, 2560 px) |
| `state` | `connecting`, `running`, `reconnecting`, `stopped`, `error`. Интерфейс сводит их к трём группам: «В эфире», «Подключение», «Нет сигнала». |
| `url` | Логин и пароль сервер маскирует. |
| `source_resolution` | `[w, h]` или `null`, пока источник не открыт. |
| `settings.analysis_fps` | `3`, `5`, `8` |
| `settings.detection_size` | `"auto"`, `640`, `1280`, `1920`, `2560`. `"auto"` означает размер по типу камеры. |
| `settings.min_face_px` | `40`, `48`, `56`, `64` |

По умолчанию `settings` = `{"enabled": true, "analysis_fps": 5, "detection_size": "auto", "min_face_px": 48}`.

### Событие (`EmotionEvent`)

```json
{"event_id": "...", "kind": "negative", "session_id": "...", "stream_id": "cam7", "camera_type": "sector",
 "track_id": 3, "start_ts": 1727780000123.4, "emit_ts": 1727780002301.0, "duration_ms": 2100,
 "emotion": "anger", "group_prob": 0.74, "state": "new"}
```

- `kind`: `negative` или `positive`.
- `state`: `new`, `confirmed`, `false_alarm` у негативных событий и `null` у позитивных. Новое негативное событие — это инцидент: оно попадает в колокольчик, пока его не подтвердят или не отметят ложным.
- `stream_id` и `camera_type` равны `null` у событий веб-камеры и файлов.
- `emotion` — самая сильная эмоция группы за время события, `group_prob` — средняя вероятность группы.

### Настройки (`AppSettings`)

```json
{"events": {"negative_emotions": ["anger", "disgust", "fear", "sadness"],
            "negative_threshold": 0.6, "positive_threshold": 0.6,
            "min_duration_s": 2, "cooldown_s": 30},
 "journal": {"interval_s": 10}}
```

| Поле | Допустимые значения (проверяет форма) |
|---|---|
| `negative_emotions` | непустое подмножество `anger, sadness, fear, disgust` |
| `negative_threshold`, `positive_threshold` | 0,5–0,9, шаг 0,05 |
| `min_duration_s` | 1–30, шаг 1 |
| `cooldown_s` | 10–300, шаг 10 |
| `journal.interval_s` | `5`, `10`, `30`, `60` |

### Сеанс (`SessionInfo`)

```json
{"id": "...", "kind": "file", "stream_id": null, "created_at": 1727780000000,
 "duration": 412, "status": "done", "file_name": "clip.mp4", "progress": 1}
```

- `kind`: `live` (веб-камера), `rtsp` (поток), `file` (запись).
- `duration` в секундах, `created_at` в epoch ms.
- `status`: `running` или `finished` у `live` и `rtsp`; `queued`, `processing`, `done`, `failed` у `file`. Пока сеанс `running`, `queued` или `processing`, удалить его нельзя.

### Файл (`FileSession`)

Сервер отдаёт файловый сеанс в списке `GET /api/sessions?kind=file` и в `GET /api/sessions/{id}`. Фронтенд приводит его к такому виду (`toFileSession` в `src/api/real.ts`):

| Поле | Описание |
|---|---|
| `status` | `queued`, `processing`, `done`, `failed`. Неизвестный статус показывается как ошибка. |
| `progress` | 0–1 или `null`. |
| `duration_ms` | Длительность записи. Если поля нет, берётся `duration × 1000`. |
| `resolution` | `[w, h]` исходника или `null`. |
| `notes` | `no_audio_track`, `no_faces_detected`, `playback_unavailable`. |
| `error` | Текст ошибки для `failed`, иначе `null`. |
| `usable_pct` | Доля пригодных кадров, 0–100. В `GET /api/sessions/{id}` лежит в `summary.usable_pct`. |

### Таймлайн записи

```json
{"session_id": "...", "kind": "file", "duration_ms": 412000,
 "frames": [{"ts_ms": 1200, "width": 640, "height": 360, "faces": [ ... ]}],
 "audio": [{"window_end_ts": 3000, "speech": true, "probs": { ... }, "label": "neutral"}]}
```

`frames` и `audio` отсортированы по времени. Кадр без лиц тоже есть в списке (пустой `faces`), по таким кадрам строятся участки «Нет лиц». У записи без звука `audio` пустой.

### Строка журнала потока (`StreamLogRow`)

```json
{"from_ts": 1727780000000, "to_ts": 1727780010000, "clients": 3,
 "dominant_emotion": "neutral", "negative_prob": 0.23, "decision": "none"}
```

`clients` — число разных треков за интервал, `negative_prob` — средняя вероятность негатива, `decision` — самое тяжёлое решение за интервал.

### Нагрузка (`SystemLoad`)

```json
{"server_ts": 1727780000000, "cpu_pct": 42, "ram_used_mb": 7400, "ram_total_mb": 15800,
 "gpu_util_pct": 55, "vram_used_mb": 1350, "vram_total_mb": 4096}
```

Поля GPU равны `null`, если видеокарты нет.

### Состояние сервера (`Health`)

```json
{"status": "ok", "device": "cuda",
 "models": {"yunet": true, "fer": true, "vad": true, "ser": true},
 "gpu_name": "NVIDIA GeForce RTX 3050 Laptop GPU", "warning": "models_loading"}
```

- `status`: `ok` или `degraded`. `device`: `cuda` или `cpu`.
- `models`: детектор лиц (`yunet`), эмоции по лицу (`fer`), детектор речи (`vad`), эмоции по голосу (`ser`).
- `warning` необязателен. Известные значения: `cuda_unavailable`, `models_loading`, `inference_failed`. Для других значений показывается общий текст.

## REST

| Метод | Путь | Запрос | Ответ |
|---|---|---|---|
| GET | `/api/health` | — | `Health` |
| GET | `/api/system` | — | `SystemLoad` |
| GET | `/api/streams` | — | `Stream[]` |
| POST | `/api/streams` | `{"name", "site", "url", "camera_type", "settings"?}` | `{"id"}`. Затем фронтенд перечитывает список и берёт новый поток из него. |
| PATCH | `/api/streams/{id}` | частичный `{"name", "site", "url", "camera_type", "settings"}` | `Stream` |
| DELETE | `/api/streams/{id}` | — | 204 или JSON |
| POST | `/api/streams/{id}/reconnect` | — | 204 или JSON |
| POST | `/api/streams/test` | `{"url"}` | `{"ok": true, "resolution": [w, h], "has_audio": true}` или `{"ok": false, "error": "текст"}` |
| GET | `/api/streams/{id}/log?interval_s=10&limit=50` | — | `StreamLogRow[]`, новые первыми |
| GET | `/api/events?kind=&state=&stream_id=&session_id=&from_ms=&to_ms=&limit=&before_id=` | — | `EmotionEvent[]`, новые первыми. Пустые параметры не передаются. `before_id` — id последнего события предыдущей страницы. |
| POST | `/api/events/{id}/ack` | `{"state": "confirmed" \| "false_alarm"}` | `EmotionEvent`. Сервер также рассылает его в `/ws/streams`. |
| GET | `/api/events/export?<фильтры>&format=csv\|json` | — | файл журнала; `limit` и `before_id` не передаются |
| GET | `/api/settings` | — | `AppSettings` |
| PUT | `/api/settings` | `AppSettings` | `AppSettings` |
| GET | `/api/sessions` | — | `SessionInfo[]` |
| GET | `/api/sessions?kind=file` | — | файловые сеансы |
| GET | `/api/sessions/{id}` | — | файловый сеанс с `summary` |
| DELETE | `/api/sessions/{id}` | — | 204; 409 «Сессия ещё идёт» для идущего сеанса |
| GET | `/api/sessions/{id}/timeline` | — | таймлайн |
| GET | `/api/sessions/{id}/media` | — | видео для плеера (`src` у `<video>`) |
| GET | `/api/sessions/{id}/export?format=csv\|json` | — | файл экспорта (ссылка с атрибутом `download`) |
| POST | `/api/files` | `multipart/form-data`, поле `file` | `{"session_id"}` |

Загрузка файла идёт через `XMLHttpRequest`, чтобы показывать прогресс отправки. Форма заранее отклоняет файлы с расширением не из списка `mp4`, `webm`, `mkv`, `avi` и файлы больше 2 ГБ. Если сервер всё же ответит 413 без JSON, фронтенд покажет «Файл больше 2 ГБ».

## WebSocket `/ws/streams`

Один сокет на всё приложение, только для просмотра. Клиент ничего не отправляет. Сервер присылает обновления по всем потокам.

**Текстовые сообщения (JSON):**

| `type` | Содержимое |
|---|---|
| `stream_result` | `{"stream_id", "frame_id", "decode_ts", "emit_ts", "faces": [лицо], "audio": голосовой блок \| null, "fps"}` |
| `stream_status` | `{"stream_id", "state", "message"?}` |
| `event` | `{"event": EmotionEvent}`. Приходит при новом событии, при завершении события (тот же `event_id` с итоговой длительностью) и после подтверждения. |
| `system` | поля `SystemLoad`, раз в секунду |

**Бинарное сообщение — кадр анализа:**

| Смещение | Размер | Поле |
|---|---|---|
| 0 | 1 | тип `0x11` |
| 1 | 2 | длина `stream_id`, uint16 LE |
| 3 | N | `stream_id`, UTF-8 |
| 3+N | 4 | `frame_id`, uint32 LE |
| 7+N | … | JPEG, длинная сторона не больше 640 px |

Как клиент обрабатывает канал:

- Задержка потока считается как `время отрисовки − (decode_ts + смещение)`. Смещение часов клиента и сервера берётся из `server_ts` в сообщениях `system`.
- Если результат потока старше 3 с, рамки и решения с плитки убираются.
- После обрыва клиент переподключается через 1, 2, 4… с, но не реже чем раз в 30 с. После переподключения он перечитывает список потоков и новые инциденты.
- После смены статуса клиент перечитывает `GET /api/streams`. Несколько изменений подряд объединяются в один запрос через 500 мс. Сообщение о потоке, которого нет в списке, вызывает повторное чтение сразу.

## WebSocket `/ws/live`

Сеанс веб-камеры. Камеру и микрофон захватывает браузер, а кадры и звук идут на сервер через этот сокет.

**Клиент → сервер:**

| Сообщение | Формат |
|---|---|
| Начало | текст `{"type": "start"}` сразу после открытия сокета |
| Конец | текст `{"type": "stop"}`, затем закрытие с кодом 1000 |
| Кадр | бинарное: `0x01` (1 байт), `capture_ts` float64 LE (8 байт), `frame_id` uint32 LE (4 байта), затем JPEG |
| Звук | бинарное: `0x02` (1 байт), `capture_ts` первого сэмпла float64 LE (8 байт), затем PCM16 LE, моно, 16 кГц |

- `capture_ts` — это `performance.timeOrigin + performance.now()`, общее время клиента для кадров и звука.
- Кадры: до 8 в секунду, длинная сторона не больше 640 px, JPEG с качеством 0,8. Пока в сокете больше 64 КБ неотправленных данных, клиент пропускает захват.
- Звук: куски по 500 мс (8000 сэмплов). Если в сокете больше 512 КБ, куски звука выбрасываются.

**Сервер → клиент (JSON):**

| `type` | Содержимое |
|---|---|
| `session` | `{"session_id"}`, один раз после `start`. После него клиент начинает отправлять кадры. |
| `frame_result` | `{"frame_id", "capture_ts", "proc_ms", "faces": [лицо], "audio": голосовой блок \| null}` |
| `error` | `{"message": "текст"}` |

- Рамки заданы в пикселях отправленного JPEG. Клиент сам масштабирует их на видео.
- Сервер может отвечать не на каждый кадр. Ответ на старый кадр клиент игнорирует.
- Задержка = время отрисовки рамки − `capture_ts`. Экран показывает p50 и p95 за 60 с.
- `error` до `session` завершает сеанс с этим текстом. `error` после `session` показывается как уведомление на 4 с.
- Если сокет закрылся сам, клиент показывает последний текст `error` или «Соединение с сервером закрыто (код N)».
- Если результата нет дольше 1 с, рамки и панель «Посетитель» очищаются.

## Экспорт

### Экспорт сеанса

`GET /api/sessions/{id}/export?format=csv|json`. JSON — массив объектов с теми же полями. Колонки CSV:

```
session_id, stream_id, ts_ms, source, track_id, box_x, box_y, box_w, box_h,
p_anger, p_disgust, p_fear, p_happiness, p_sadness, p_surprise, p_neutral,
face_label, audio_label, fused_label, speech
```

- `source` — `face` или `audio`.
- Строки лиц содержат рамку и вероятности по лицу.
- Строки голоса содержат вероятности голоса, `audio_label` и `speech`. Колонки рамки у них пустые.
- `stream_id` пустой у веб-камеры и файлов.

### Экспорт журнала

`GET /api/events/export?<фильтры>&format=csv|json`. Колонки:

```
event_id, kind, session_id, stream_id, camera_type, track_id, start_ts, emit_ts,
duration_ms, emotion, group_prob, state
```
