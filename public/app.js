// ---------------------------------------------------------------------------
// Two-way voice conversation.
//
//   Person A speaks their language  ->  Person B hears it in their language
//   Person B speaks their language  ->  Person A hears it in their language
//
// The translation direction simply flips depending on who pressed their button.
// ---------------------------------------------------------------------------

// The languages offered in both dropdowns
const LANGUAGES = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese",
  "Dutch", "Hindi", "Japanese", "Korean", "Mandarin Chinese", "Arabic",
];

// ElevenLabs' built-in default voices. Used if your account's voices can't be fetched.
const FALLBACK_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily" },
];

// Grab the page elements
const el = {
  langA: document.getElementById("langA"),
  langB: document.getElementById("langB"),
  voiceA: document.getElementById("voiceA"),
  voiceB: document.getElementById("voiceB"),
  recordA: document.getElementById("recordA"),
  recordB: document.getElementById("recordB"),
  status: document.getElementById("status"),
  conversation: document.getElementById("conversation"),
  audio: document.getElementById("audio"),
};

let mediaRecorder; // the browser's audio recorder
let chunks = []; // pieces of recorded audio
let recordingPerson = null; // "A", "B", or null when no one is recording

// --- Setup helpers ----------------------------------------------------------

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.style.color = isError ? "#c0392b" : "#555";
}

// Fill a <select> with the language list, choosing a default
function fillLanguages(selectEl, defaultLanguage) {
  LANGUAGES.forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = lang;
    if (lang === defaultLanguage) option.selected = true;
    selectEl.appendChild(option);
  });
}

// Fill a voice <select> with a list of voices
function fillVoiceDropdown(selectEl, voices) {
  selectEl.innerHTML = "";
  voices.forEach((v) => {
    const option = document.createElement("option");
    option.value = v.id;
    option.textContent = v.name;
    selectEl.appendChild(option);
  });
}

// Ask our server which voices are available, and fill BOTH voice dropdowns
async function loadVoices() {
  let voices = FALLBACK_VOICES;
  try {
    const response = await fetch("/api/voices");
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    if (data.voices && data.voices.length > 0) voices = data.voices;
  } catch (err) {
    console.warn("Using fallback voices because:", err.message);
  }

  fillVoiceDropdown(el.voiceA, voices);
  fillVoiceDropdown(el.voiceB, voices);
  // Give Person B a different default voice so the two sound distinct
  if (el.voiceB.options.length > 1) el.voiceB.selectedIndex = 1;
}

// --- Recording --------------------------------------------------------------

async function startRecording(person) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = (event) => chunks.push(event.data);
    mediaRecorder.onstop = () => sendRecording(person); // remember who spoke
    mediaRecorder.start();

    recordingPerson = person;
    const btn = person === "A" ? el.recordA : el.recordB;
    const otherBtn = person === "A" ? el.recordB : el.recordA;
    btn.textContent = "⏹ Stop & Translate";
    btn.classList.add("recording");
    otherBtn.disabled = true; // only one person talks at a time
    setStatus(`🎤 Person ${person} is speaking… press stop when done.`);
  } catch (err) {
    setStatus("Microphone access was blocked: " + err.message, true);
  }
}

function stopRecording() {
  const person = recordingPerson;
  mediaRecorder.stop(); // this triggers sendRecording() via onstop
  recordingPerson = null;

  const btn = person === "A" ? el.recordA : el.recordB;
  const otherBtn = person === "A" ? el.recordB : el.recordA;
  btn.textContent = person === "A" ? "🎤 Person A speaks" : "🎤 Person B speaks";
  btn.classList.remove("recording");
  otherBtn.disabled = false;
  setStatus("⏳ Translating…");
}

// Decide what to do when a record button is pressed
function handleRecordClick(person) {
  if (recordingPerson === null) startRecording(person);
  else if (recordingPerson === person) stopRecording();
  // (if the other person is recording, their button is disabled anyway)
}

el.recordA.addEventListener("click", () => handleRecordClick("A"));
el.recordB.addEventListener("click", () => handleRecordClick("B"));

// --- Send the recording and handle the result -------------------------------

async function sendRecording(person) {
  mediaRecorder.stream.getTracks().forEach((track) => track.stop());

  // Work out the direction of translation based on who spoke
  const spokenLanguage = person === "A" ? el.langA.value : el.langB.value;
  const targetLanguage = person === "A" ? el.langB.value : el.langA.value;
  // Use the speaking person's own selected voice
  const voiceId = person === "A" ? el.voiceA.value : el.voiceB.value;
  const listener = person === "A" ? "B" : "A";

  const audioBlob = new Blob(chunks, { type: "audio/webm" });
  const formData = new FormData();
  formData.append("audio", audioBlob, "audio.webm");
  formData.append("targetLanguage", targetLanguage);
  formData.append("voiceId", voiceId);

  try {
    const response = await fetch("/api/translate", { method: "POST", body: formData });
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    addTurn(person, spokenLanguage, data.sourceText, targetLanguage, data.translatedText);

    el.audio.src = "data:audio/mpeg;base64," + data.audioBase64;
    el.audio.play();
    setStatus(`✅ Person ${listener}, listen!`);
  } catch (err) {
    setStatus("Something went wrong: " + err.message, true);
  }
}

// Add one message to the conversation transcript (newest on top)
function addTurn(person, fromLang, original, toLang, translated) {
  const turn = document.createElement("div");
  turn.className = "turn turn-" + person.toLowerCase();
  turn.innerHTML =
    `<div class="turn-who">Person ${person} · ${escapeHtml(fromLang)} → ${escapeHtml(toLang)}</div>` +
    `<div class="turn-orig">${escapeHtml(original)}</div>` +
    `<div class="turn-trans">${escapeHtml(translated)}</div>`;
  el.conversation.prepend(turn);
}

// Safely turn user/AI text into displayable HTML (prevents broken layouts)
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Start everything -------------------------------------------------------
fillLanguages(el.langA, "English");
fillLanguages(el.langB, "Spanish");
loadVoices();
