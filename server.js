// ---------------------------------------------------------------------------
// Live Translator — backend server
//
// This file is the "brain" of the app. It runs on a server (your computer when
// developing, or Render when deployed) and does three things in order:
//
//   1. Speech-to-Text  : turn the recorded voice into text   (ElevenLabs Scribe)
//   2. Translation     : translate that text                 (Claude / Anthropic)
//   3. Text-to-Speech  : turn the translation into audio      (ElevenLabs TTS)
//
// The browser (see the /public folder) records your voice, sends it here, and
// plays back whatever audio we return.
// ---------------------------------------------------------------------------

import "dotenv/config"; // loads ELEVENLABS_API_KEY / ANTHROPIC_API_KEY from a .env file
import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
const upload = multer(); // keeps uploaded audio in memory as a Buffer (no temp files)

// --- API keys ---------------------------------------------------------------
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const anthropic = new Anthropic(); // automatically reads ANTHROPIC_API_KEY from the environment

// Serve the website (everything inside the /public folder)
app.use(express.static("public"));

// Small helper: if a key is missing, send a clear error instead of crashing.
function keysAreMissing(res) {
  if (!ELEVENLABS_API_KEY) {
    res.status(500).json({ error: "Missing ELEVENLABS_API_KEY — see the README setup steps." });
    return true;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Missing ANTHROPIC_API_KEY — see the README setup steps." });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// ROUTE 1: list the available ElevenLabs voices (used to fill the dropdown menu)
// ---------------------------------------------------------------------------
app.get("/api/voices", async (req, res) => {
  if (keysAreMissing(res)) return;
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    });
    if (!response.ok) {
      const body = await response.text();
      console.error(`⚠️  /v1/voices failed (status ${response.status}):`, body);
      throw new Error(`Could not load voices (status ${response.status})`);
    }

    const data = await response.json();
    const voices = data.voices.map((v) => ({ id: v.voice_id, name: v.name }));
    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ROUTE 2: the main pipeline — voice in, translated voice out
// ---------------------------------------------------------------------------
app.post("/api/translate", upload.single("audio"), async (req, res) => {
  if (keysAreMissing(res)) return;
  try {
    const targetLanguage = req.body.targetLanguage || "Spanish";
    const voiceId = req.body.voiceId;

    if (!req.file) return res.status(400).json({ error: "No audio was received." });
    if (!voiceId) return res.status(400).json({ error: "No voice was selected." });

    // --- Step 1: Speech-to-Text (ElevenLabs Scribe) -----------------------
    const sttForm = new FormData();
    sttForm.append("model_id", "scribe_v1");
    sttForm.append("file", new Blob([req.file.buffer]), "audio.webm");

    const sttResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      body: sttForm,
    });
    if (!sttResponse.ok) {
      const body = await sttResponse.text();
      console.error(`⚠️  speech-to-text failed (status ${sttResponse.status}):`, body);
      throw new Error(`Speech-to-text failed (status ${sttResponse.status})`);
    }

    const sttData = await sttResponse.json();
    const sourceText = (sttData.text || "").trim();
    if (!sourceText) throw new Error("I couldn't hear any speech — please try again.");

    // --- Step 2: Translate the text (Claude) ------------------------------
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5", // cheapest + fastest Claude model — great for short translations
      max_tokens: 1024,
      system:
        `You are a translation engine. Translate the user's message into ${targetLanguage}. ` +
        `Output ONLY the translation — no quotes, no notes, no explanations.`,
      messages: [{ role: "user", content: sourceText }],
    });
    const textBlock = message.content.find((block) => block.type === "text");
    const translatedText = textBlock ? textBlock.text.trim() : "";

    // --- Step 3: Text-to-Speech (ElevenLabs) ------------------------------
    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: translatedText,
          model_id: "eleven_multilingual_v2", // handles many languages in one model
        }),
      }
    );
    if (!ttsResponse.ok) {
      const body = await ttsResponse.text();
      console.error(`⚠️  text-to-speech failed (status ${ttsResponse.status}):`, body);
      throw new Error(`Text-to-speech failed (status ${ttsResponse.status})`);
    }

    // The audio comes back as raw bytes. We convert it to a base64 string so it
    // can travel inside a normal JSON response alongside the text.
    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    const audioBase64 = audioBuffer.toString("base64");

    // Send the original text, the translation, and the spoken audio back.
    res.json({ sourceText, translatedText, audioBase64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Live Translator running at http://localhost:${PORT}`);
});
