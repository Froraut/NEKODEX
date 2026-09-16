function applicationMenu({ name, checkLabel, onCheck }) {
  return [
    { label: name, submenu: [
      { role: "about" },
      { id: "check-for-updates", label: checkLabel, click: onCheck },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { role: "quit" },
    ] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ];
}
module.exports = { applicationMenu };
