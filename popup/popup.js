"use strict";

const STORAGE_KEY = "mode";
const DEFAULT_MODE = "on";
const MODES = new Set(["on", "off", "auto"]);

const radios = [...document.querySelectorAll('input[name="mode"]')];
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");

const setStatus = (text, state) => {
  statusText.textContent = text;
  statusDot.dataset.state = state;
};

chrome.storage.local.get(STORAGE_KEY, (stored) => {
  const mode = MODES.has(stored?.[STORAGE_KEY]) ? stored[STORAGE_KEY] : DEFAULT_MODE;
  const match = radios.find((r) => r.value === mode);
  if (match) match.checked = true;
  refreshStatus();
});

for (const radio of radios) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    chrome.storage.local.set({ [STORAGE_KEY]: radio.value }, () => {
      // The content script applies on storage change; give it a beat to settle
      // before asking what actually happened.
      setTimeout(refreshStatus, 60);
    });
  });
}

// Reports what is true on the tab in front of the user, not just what was
// stored — which strategy ran depends on the page, so only the content script
// knows. It answers over a tab id, which needs no permission beyond the one the
// content script already has; reading tab.url would need activeTab, and that is
// not worth requesting for a status line.
async function refreshStatus() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    setStatus("Can't read the current tab.", "attention");
    return;
  }

  let state = null;
  if (tab?.id !== undefined) {
    try {
      state = await chrome.tabs.sendMessage(tab.id, { type: "dmli:get-state" });
    } catch {
      state = null; // no content script here
    }
  }

  if (!state) {
    // Without tab.url the two reasons for silence are indistinguishable — not a
    // LinkedIn tab, or one opened before the extension loaded — so say both.
    setStatus("Open a LinkedIn tab, or reload one that was already open.", "idle");
    return;
  }

  if (state.strategy === "unsupported") {
    setStatus("This LinkedIn page can't be themed safely, so it's left alone.", "attention");
    return;
  }
  if (state.applied) {
    setStatus(
      state.strategy === "recolor"
        ? "Dark theme is active on this tab."
        : "LinkedIn's own dark theme is switched on for this tab.",
      "active",
    );
    return;
  }
  setStatus(
    state.mode === "auto"
      ? "Your system is set to light, so LinkedIn stays light."
      : "Theme is off. LinkedIn is showing its normal colors.",
    "idle",
  );
}
