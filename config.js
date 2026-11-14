// The only file you need to edit.
// Paste the Google Apps Script web app URL between the quotes (it ends in /exec).
// While it is empty, both pages run in demo mode and nothing is saved.
window.POLL_CONFIG = {
  api: "https://script.google.com/macros/s/AKfycbxFd0MWjVnPA5pT8A6_JgNL_AlV17tw2iskueEC78g78oMil9qlUK46ASYvL_IsqRqp/exec",

  // Countdown on each phone, in seconds. It starts when the person taps Start.
  voteSeconds: 30,

  // Optional: a link shown on phones after voting (for example your slides or Drive folder).
  // Leave "" to hide it.
  materialsUrl: "",
  materialsLabel: "Slides, references and the one-page summary"
};
