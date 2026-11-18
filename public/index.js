"use strict";

// Zenith is allowed to send commands from these Google Apps Script origins.
const ALLOWED_ORIGINS = [
  "https://script.google.com",
  "https://script.googleusercontent.com"
];

// Scramjet configuration
const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
  files: {
    wasm: "/scram/scramjet.wasm.wasm",
    all: "/scram/scramjet.all.js",
    sync: "/scram/scramjet.sync.js"
  }
});

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

let proxyFrame = null;
let initialized = false;

// Send messages back to Zenith.
function sendToZenith(message) {
  const origin = document.referrer
    ? new URL(document.referrer).origin
    : "";

  if (ALLOWED_ORIGINS.includes(origin)) {
    window.parent.postMessage(message, origin);
  }
}

// Initialize Scramjet and its connection.
async function initializeScramjet() {
  if (initialized) return;

  try {
    await registerSW();

    scramjet.init();

    const wispUrl =
      (location.protocol === "https:" ? "wss" : "ws") +
      "://" +
      location.host +
      "/wisp/";

    if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
      await connection.setTransport("/libcurl/index.mjs", [
        { websocket: wispUrl }
      ]);
    }

    initialized = true;

    sendToZenith({
      type: "ZENITH_PROXY_READY"
    });

  } catch (error) {
    console.error("Zenith proxy initialization failed:", error);

    sendToZenith({
      type: "ZENITH_PROXY_ERROR",
      message: error.message || String(error)
    });

    throw error;
  }
}

// Load a website through Scramjet.
async function navigate(url) {
  await initializeScramjet();

  const parsed = new URL(url);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }

  if (!proxyFrame) {
    proxyFrame = scramjet.createFrame();

    proxyFrame.frame.id = "zenith-proxy-frame";
    proxyFrame.frame.style.width = "100%";
    proxyFrame.frame.style.height = "100%";
    proxyFrame.frame.style.border = "0";

    document
      .getElementById("proxy-container")
      .appendChild(proxyFrame.frame);
  }

  proxyFrame.go(parsed.href);

  sendToZenith({
    type: "ZENITH_NAVIGATED",
    url: parsed.href
  });
}

// Receive commands from Zenith.
window.addEventListener("message", async (event) => {
  if (event.source !== window.parent) return;
  if (!ALLOWED_ORIGINS.includes(event.origin)) return;

  const data = event.data;

  if (!data || typeof data !== "object") return;

  try {
    if (data.type === "ZENITH_NAVIGATE") {
      if (typeof data.url !== "string") return;

      await navigate(data.url);
    }

    if (data.type === "ZENITH_RELOAD" && proxyFrame) {
      proxyFrame.go(proxyFrame.frame.src);
    }

  } catch (error) {
    console.error("Zenith navigation failed:", error);

    sendToZenith({
      type: "ZENITH_PROXY_ERROR",
      message: error.message || String(error)
    });
  }
});

// Tell Zenith that the engine page has loaded.
sendToZenith({
  type: "ZENITH_ENGINE_LOADED"
});
