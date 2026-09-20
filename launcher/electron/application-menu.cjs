function applicationMenu({ name, checkLabel, onCheck, quitLabel, stopLabel, onStop, language = "en" }) {
  if (language === "ru") return [
    { label: name, submenu: [
      { role: "about", label: `О программе ${name}` },
      { id: "check-for-updates", label: checkLabel, click: onCheck },
      { type: "separator" }, { role: "services", label: "Службы" },
      { type: "separator" }, { role: "hide", label: `Скрыть ${name}` },
      { role: "hideOthers", label: "Скрыть остальные" }, { role: "unhide", label: "Показать все" },
      { type: "separator" }, { role: "quit", label: quitLabel || `Завершить ${name}` },
      ...(onStop ? [{ label: stopLabel, click: onStop }] : []),
    ] },
    { label: "Правка", submenu: [
      { role: "undo", label: "Отменить" }, { role: "redo", label: "Повторить" },
      { type: "separator" }, { role: "cut", label: "Вырезать" }, { role: "copy", label: "Копировать" },
      { role: "paste", label: "Вставить" }, { role: "pasteAndMatchStyle", label: "Вставить с текущим стилем" },
      { role: "delete", label: "Удалить" }, { role: "selectAll", label: "Выбрать всё" },
      { type: "separator" }, { label: "Речь", submenu: [
        { role: "startSpeaking", label: "Начать чтение" }, { role: "stopSpeaking", label: "Остановить чтение" },
      ] },
    ] },
    { label: "Вид", submenu: [
      { role: "reload", label: "Обновить" }, { role: "forceReload", label: "Обновить без кеша" },
      { role: "toggleDevTools", label: "Инструменты разработчика" }, { type: "separator" },
      { role: "resetZoom", label: "Исходный масштаб" }, { role: "zoomIn", label: "Увеличить масштаб" },
      { role: "zoomOut", label: "Уменьшить масштаб" }, { type: "separator" },
      { role: "togglefullscreen", label: "Полноэкранный режим" },
    ] },
    { role: "windowMenu", label: "Окно", submenu: [
      { role: "minimize", label: "Свернуть" }, { role: "zoom", label: "Масштабировать" },
      { type: "separator" }, { role: "front", label: "Все окна на передний план" },
      { type: "separator" }, { role: "window", label: "Окно" },
    ] },
  ];
  return [
    { label: name, submenu: [
      { role: "about" },
      { id: "check-for-updates", label: checkLabel, click: onCheck },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { role: "quit", ...(quitLabel ? { label: quitLabel } : {}) },
      ...(onStop ? [{ label: stopLabel, click: onStop }] : []),
    ] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ];
}
module.exports = { applicationMenu };
