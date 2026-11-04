# Реестр предметов AE

Источник правды — `content/subjects.json` (порядок карточек на стартовом экране, названия, значки, адреса).
Этот файл — человекочитаемая сводка; при добавлении предмета обновляйте оба.

| | Предмет | id | Адрес и префикс ID | Стиль | Статус | Документы |
|---|---|---|---|---|---|---|
| 🧠 | Aviation Psychology and Crew Resource Management (CRM) | `crm` | `#/crm` · ID `crm-…` | notes | темы 1–8 из 14 (22 темы, 136 вопросов), утверждено и опубликовано | [журнал](crm.md) · [отчёт](crm-report.md) |
| ⚡ | Circuit Theory | `circuits` | `#/ct` · ID `ct-…` | notes | лекции 1–6, практики и лабораторные (30 тем, 181 вопрос), утверждено и опубликовано | [журнал](circuits.md) · [отчёт](circuits-report.md) |
| 💰 | Cost Engineering | `cost` | `#/ce` · ID `ce-…` | notes | курс готовится | [журнал](cost.md) · [отчёт](cost-report.md) |
| 🩺 | Human Performance and Medicine | `hpm` | `#/hpm` · ID `hpm-…` | notes | лекции 1–7 (31 тема, 205 вопросов), утверждено и опубликовано | [журнал](hpm.md) · [отчёт](hpm-report.md) |
| 💧 | Hydraulics and Hydraulic Systems | `hydraulics` | `#/hyd` · ID `hyd-…` | notes | курс готовится | [журнал](hydraulics.md) · [отчёт](hydraulics-report.md) |
| 📐 | Mathematics III | `math3` | `#/m3` · ID `m3-…` | notes | лекции 1–8 (30 тем, 206 вопросов), утверждено и опубликовано | [журнал](math3.md) · [отчёт](math3-report.md) |
| ⚙️ | Mechanics | `mechanics` | `#/mech` · ID `mech-…` | notes | курс готовится | [журнал](mechanics.md) · [отчёт](mechanics-report.md) |

## Как добавить новый предмет

1. Допишите запись в `content/subjects.json`: `id` (латиница и цифры, менять потом нельзя — от него зависят ключи хранилища и документы базы), `prefix` (первый сегмент адреса и начало всех ID; не совпадает с экранами `library`, `topic`, `test`, `admin` и т. п.), `emoji`, `icon` (из набора в `src/ui/components/Icon.tsx`), `tone` (`accent` | `ok` | `warn` | `bad`), `title`, `short`, `tagline`, `style` (`notes` | `book`), `vocab` (`materials` | `notes` | `book`).
2. Создайте `content/subjects/<id>/src/00-structure.yaml` (образец — любой пустой предмет) и журнал `docs/subjects/<id>.md`.
3. `npm run content:build` — соберёт учебную базу и обновит `src/data/packs.generated.ts`; `npm run release:pack` — релизную базу.
4. `npm run test:unit` — тесты сами проверят новый предмет (реестр, значок, ID, ссылки на страницы, формулы, ответы).

Интерфейс от конкретного предмета не зависит: экраны, тесты, админ-панель, синхронизация и релизная сборка работают для любого предмета из реестра.
