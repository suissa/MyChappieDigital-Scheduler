/**
 * `AiPort` implementations.
 *
 * `offlineAiGateway` is deterministic — no network, safe for the slice + tests.
 * `httpAiGateway` routes transcription to an OpenAI-compatible ASR endpoint,
 * completion to an OpenAI-compatible chat endpoint and synthesis to ElevenLabs,
 * reading every URL / model id / key-env-var from `config/`. It is only reached
 * when a behaviour's config says `live: true`.
 */

import type { AiPort, HttpPort } from "../behaviors/kind.js";
import { ASR_PROVIDER, type AsrProviderKey } from "../../config/transcription.js";
import { ELEVENLABS } from "../../config/speech.js";
import { GROQ } from "../../config/integrations.js";

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export const offlineAiGateway: AiPort = {
  async transcribe(req) {
    const minutes = Math.max(1, Math.ceil(req.durationSeconds / 60));
    const provider = ASR_PROVIDER[req.providerKey as AsrProviderKey];
    return {
      text: req.offlineTranscript ?? `[transcrição simulada de ${req.audioRef}]`,
      costCentavos: provider ? minutes * provider.costPerMinute : 0,
      modelId: provider?.modelId ?? "offline",
      simulated: true,
    };
  },
  async complete(req) {
    const text = req.offlineCompletion ?? "{}";
    return {
      text,
      tokensIn: Math.ceil(req.prompt.length / 4),
      tokensOut: Math.ceil(text.length / 4),
      simulated: true,
    };
  },
  async synthesize(req) {
    return {
      audioRef: `mem://speech/${Buffer.from(`${req.voiceId}:${req.language}:${req.text}`).toString("base64url").slice(0, 24)}.mp3`,
      characterCount: [...req.text].length,
      simulated: true,
    };
  },
};

export const httpAiGateway = (http: HttpPort, tokenFor: (envVar: string) => string | undefined): AiPort => ({
  async transcribe(req) {
    const provider = ASR_PROVIDER[req.providerKey as AsrProviderKey];
    if (!provider || !provider.live) return offlineAiGateway.transcribe(req);
    const url = provider.baseUrl + provider.transcriptionPath;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (provider.key === "groq") {
      const key = tokenFor(GROQ.baseUrl) ?? tokenFor("GROQ_API_KEY");
      if (key) headers["authorization"] = `Bearer ${key}`;
    }
    const res = await http.request({
      method: "POST",
      url,
      headers,
      body: { model: provider.modelId, audio_ref: req.audioRef, language: req.language ?? "pt" },
    });
    const body = res.json as { text?: string };
    const minutes = Math.max(1, Math.ceil(req.durationSeconds / 60));
    return {
      text: body.text ?? "",
      costCentavos: minutes * provider.costPerMinute,
      modelId: provider.modelId,
      simulated: false,
    };
  },
  async complete(req) {
    if (!req.live) return offlineAiGateway.complete(req);
    // OpenAI-compatible chat/completions on a local gateway.
    const res = await http.request({
      method: "POST",
      url: "http://127.0.0.1:8080/v1/chat/completions",
      headers: { "content-type": "application/json" },
      body: {
        model: req.modelId,
        temperature: req.temperature,
        messages: [{ role: "user", content: req.prompt }],
      },
    });
    const body = res.json as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content ?? "{}";
    return {
      text,
      tokensIn: body.usage?.prompt_tokens ?? Math.ceil(req.prompt.length / 4),
      tokensOut: body.usage?.completion_tokens ?? Math.ceil(text.length / 4),
      simulated: false,
    };
  },
  async synthesize(req) {
    if (!req.live || !ELEVENLABS.live) return offlineAiGateway.synthesize(req);
    const key = tokenFor("ELEVENLABS_API_KEY");
    const res = await http.request({
      method: "POST",
      url: `${ELEVENLABS.baseUrl}${ELEVENLABS.ttsPath}/${req.voiceId}`,
      headers: {
        "content-type": "application/json",
        ...(key ? { "xi-api-key": key } : {}),
      },
      body: { text: req.text, model_id: req.modelId, output_format: ELEVENLABS.outputFormat },
    });
    return {
      audioRef: `elevenlabs://tts/${req.voiceId}#${res.status}`,
      characterCount: [...req.text].length,
      simulated: false,
    };
  },
});

export { wordCount };
