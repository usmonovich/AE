// Флаги сборки (tools/build.mjs). Без сборщика (тесты) — значения по умолчанию.
declare const __ADMIN__: boolean | undefined;

/** Админ-панель есть только в личной версии владельца (опубликованная страница). В сборке для
 *  магазинов и публичного сайта (npm run build:release) её нет: ни маршрута, ни ссылок, ни предпросмотра. */
export const ADMIN_ENABLED: boolean = typeof __ADMIN__ === 'undefined' ? true : __ADMIN__;
