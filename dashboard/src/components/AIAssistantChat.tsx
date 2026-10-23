import React, { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, Send, Mic, MicOff, Globe, AlertCircle, Settings, Sparkles } from "lucide-react";
import { SpeechButton } from "./ui";
import { getOpenRouterKey, getOpenRouterModel } from "../utils/aiPreferences";
import { getGeminiKey, chatWithGemma } from "../utils/gemmaClient";
import { getHideBPAndRespiration } from "../utils/preferences";

interface AIAssistantChatProps {
  biomarkerData: Record<string, unknown> | null | undefined;
  patient?: { name: string; age: number; sex: string } | null;
}

// ── Voice language options ────────────────────────────────────────────────────

type VoiceLang = "en-IN" | "hi-IN" | "bn-IN";

interface VoiceLangOption {
  code: VoiceLang;
  label: string;
  flag: string;
  placeholder: string;
}

const VOICE_LANGS: VoiceLangOption[] = [
  { code: "en-IN", label: "English", flag: "🇬🇧", placeholder: "E.g. What does my SpO2 reading mean?" },
  { code: "hi-IN", label: "हिंदी",   flag: "🇮🇳", placeholder: "जैसे: मेरा SpO₂ क्या है?" },
  { code: "bn-IN", label: "বাংলা",   flag: "🇧🇩", placeholder: "যেমন: আমার SpO₂ কী বোঝায়?" },
];

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode {
  return text.split("\n").map((line, li) => {
    const trimmed = line.trimStart();
    const isBullet = /^[-*•]\s+/.test(trimmed);
    const content = isBullet ? trimmed.replace(/^[-*•]\s+/, "") : line;
    const parts = content.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    const rendered = parts.map((part, pi) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={pi}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("*") && part.endsWith("*"))
        return <em key={pi}>{part.slice(1, -1)}</em>;
      if (part.startsWith("`") && part.endsWith("`"))
        return <code key={pi} style={{ background: "rgba(255,255,255,0.1)", padding: "1px 5px", borderRadius: 4, fontSize: "0.88em" }}>{part.slice(1, -1)}</code>;
      return part;
    });
    if (isBullet)
      return (
        <div key={li} style={{ display: "flex", gap: 8, marginLeft: 8, marginTop: 3 }}>
          <span style={{ color: "var(--accent)" }}>•</span>
          <span>{rendered}</span>
        </div>
      );
    if (line.trim() === "") return <br key={li} />;
    return <div key={li}>{rendered}</div>;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

const AIAssistantChat: React.FC<AIAssistantChatProps> = ({ biomarkerData, patient }) => {
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{ sender: string; text: string }[]>([]);
  const [isChatting, setIsChatting] = useState(false);

  // Voice states
  const [voiceLang, setVoiceLang] = useState<VoiceLang>("en-IN");
  const [isListening, setIsListening] = useState(false);
  const [liveSubtitle, setLiveSubtitle] = useState(""); 
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check browser support on mount
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setVoiceSupported(!!SR);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isChatting]);

  // ── Voice helpers ─────────────────────────────────────────────────────────────

  const clearSubtitleAfterDelay = useCallback((ms: number) => {
    if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
    subtitleTimerRef.current = setTimeout(() => setLiveSubtitle(""), ms);
  }, []);

  const stopVoice = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch (_) {}
    recognitionRef.current = null;
    setIsListening(false);
    clearSubtitleAfterDelay(1500);
  }, [clearSubtitleAfterDelay]);

    const startVoice = useCallback(() => {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) {
        setVoiceError("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
        return;
      }

      setVoiceError(null);

      // Request microphone permission explicitly
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => {
          // Stop any existing session first
          try { recognitionRef.current?.stop(); } catch (_) {}
          if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);

          const rec: SpeechRecognition = new SR();
          rec.lang = voiceLang;
          rec.continuous = false;      // false is more reliable cross-browser
          rec.interimResults = true;
          rec.maxAlternatives = 1;

          rec.onstart = () => {
            setIsListening(true);
            setLiveSubtitle("");
            setVoiceError(null);
          };

          rec.onresult = (event: SpeechRecognitionEvent) => {
            // Accumulate ALL results: interim ones are shown live, final ones go to input
            let interimText = "";
            let finalText = "";

            for (let i = 0; i < event.results.length; i++) {
              const transcript = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                finalText += transcript;
              } else {
                interimText += transcript;
              }
            }

            // Show whichever is available as live subtitle
            setLiveSubtitle(interimText || finalText);

            // Commit final text to input
            if (finalText.trim()) {
              setChatInput(prev => {
                const trimmedPrev = prev.trim();
                return trimmedPrev ? `${trimmedPrev} ${finalText.trim()}` : finalText.trim();
              });
            }
          };

          rec.onerror = (e: SpeechRecognitionErrorEvent) => {
            setIsListening(false);
            if (e.error === "no-speech") {
              setVoiceError("No speech detected. Tap the mic and try again.");
            } else if (e.error === "not-allowed") {
              setVoiceError("Microphone permission denied. Please allow mic access in your browser.");
            } else if (e.error === "network") {
              setVoiceError("Network error. Check your internet connection.");
            } else {
              setVoiceError(`Voice error: ${e.error}. Try again.`);
            }
            clearSubtitleAfterDelay(1500);
          };

          rec.onend = () => {
            setIsListening(false);
            // Keep subtitle visible for 2s so user can confirm what was heard
            clearSubtitleAfterDelay(2000);
          };

          recognitionRef.current = rec;
          try {
            rec.start();
          } catch (e) {
            setVoiceError("Could not start microphone. Is another app using it?");
            setIsListening(false);
          }
        })
        .catch(() => {
          setVoiceError("Microphone permission was denied. Please allow access in your browser settings.");
        });
    }, [voiceLang, clearSubtitleAfterDelay]);

  const toggleVoice = () => {
    if (isListening) stopVoice();
    else startVoice();
  };

  // Reset voice when language changes
  useEffect(() => {
    if (isListening) stopVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceLang]);

  // ── Send message ─────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    const message = chatInput.trim();
    if (!message || isChatting) return;

    const apiKey = getOpenRouterKey();
    if (!apiKey) {
      setChatHistory(prev => [...prev, {
        sender: "System",
        text: "⚠️ No OpenRouter API key found. Go to **Settings** and add your OpenRouter key to use the AI assistant.",
      }]);
      return;
    }

    if (isListening) stopVoice();

    const userMsg = { sender: "You", text: message };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput("");
    setIsChatting(true);

    // Build biomarker context
    const hideBpResp = getHideBPAndRespiration();
    const ctx = biomarkerData
      ? Object.entries(biomarkerData)
          .filter(([k, v]) => {
            if (v == null) return false;
            if (hideBpResp && ["bpSys","bpDia","respRate","systolicBP","diastolicBP","respirationRate"].includes(k)) return false;
            return true;
          })
          .map(([k, v]) => `${k}: ${typeof v === "number" ? (v as number).toFixed(2) : v}`)
          .join(", ")
      : "No biomarker data available yet.";

    const demographicCtx = patient
      ? `Patient Demographics: Age ${patient.age}, Sex ${patient.sex}. `
      : "";

    const langInstruction =
      voiceLang === "hi-IN" ? "Please respond entirely in Hindi (Devanagari script)." :
      voiceLang === "bn-IN" ? "Please respond entirely in Bengali (Bengali script)." :
      "Please respond in English.";

    try {
      const geminiKey = getGeminiKey();
      if (geminiKey) {
        try {
          const { reply } = await chatWithGemma(chatHistory, message, voiceLang, demographicCtx, ctx);
          if (reply && reply.trim()) {
            setChatHistory(prev => [...prev, { sender: "AI (Gemma 4)", text: reply.trim() }]);
            setIsChatting(false);
            return;
          }
        } catch (gemmaErr) {
          console.warn("[GemmaChat] Gemma 4 call failed, trying OpenRouter fallback:", gemmaErr);
        }
      }

      const preferredModel = getOpenRouterModel("assistantChat");
      const candidateModels = Array.from(new Set([
        preferredModel,
        'openai/gpt-4o-mini',
        'nex-agi/nex-n2.5-mini:free',
        'deepseek/deepseek-v4-flash-0731:free',
      ]));

      let reply = '';
      let lastErrMsg = '';

      for (const candidate of candidateModels) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        try {
          const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
              "HTTP-Referer": window.location.origin,
              "X-Title": "Anebilin Health Assistant",
            },
            body: JSON.stringify({
              model: candidate,
              messages: [
                {
                  role: "system",
                  content: `You are a warm, friendly medical AI assistant for the Anebilin non-invasive health screening device. ${demographicCtx}
The patient's latest biomarker readings: ${ctx}.

${langInstruction}

RULES:
- NEVER use the patient's name or any personally identifiable information.
- Focus on health, biomarkers, symptoms, wellness, and medical questions.
- Explain values in plain, simple language that a non-medical person can understand.
- Use **bold** for key terms and bullet points for lists.
- Always remind them this is screening data — not a diagnosis — and to consult a doctor for medical concerns.
- Be concise, warm, and empathetic.`,
                },
                ...chatHistory
                  .filter(m => m.sender === "You" || m.sender === "AI")
                  .map(m => ({
                    role: m.sender === "You" ? "user" as const : "assistant" as const,
                    content: m.text,
                  })),
                { role: "user" as const, content: message },
              ],
              temperature: 0.65,
              max_tokens: 800,
              reasoning: { effort: 'none' },
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errMsg = (errBody as any)?.error?.message ?? `HTTP ${res.status}`;
            lastErrMsg = errMsg;
            console.warn(`Assistant candidate ${candidate} returned ${res.status}: ${errMsg}`);
            continue;
          }

          const data = await res.json();
          const rawReply = data.choices?.[0]?.message?.content;
          const extractedReply = Array.isArray(rawReply)
            ? rawReply.map((p: any) => p?.text || '').join('\n').trim()
            : typeof rawReply === 'string'
            ? rawReply.trim()
            : '';

          if (extractedReply) {
            reply = extractedReply;
            break;
          }
        } catch (candErr: unknown) {
          clearTimeout(timeoutId);
          lastErrMsg = candErr instanceof Error ? candErr.message : String(candErr);
          console.warn(`Assistant candidate ${candidate} failed: ${lastErrMsg}`);
        }
      }

      if (reply) {
        setChatHistory(prev => [...prev, { sender: "AI", text: reply }]);
      } else {
        setChatHistory(prev => [...prev, {
          sender: "System",
          text: `⚠️ Error: ${lastErrMsg || 'Unable to connect to AI assistant'}. Check your OpenRouter key or model in Settings.`,
        }]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setChatHistory(prev => [...prev, {
        sender: "System",
        text: `⚠️ Error: ${msg}. Check your OpenRouter key in Settings and try again.`,
      }]);
    }
    setIsChatting(false);
  };

  // Submit on Enter
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const hasGeminiKey = !!getGeminiKey();
  const hasOpenRouterKey = !!getOpenRouterKey();
  const hasApiKey = hasGeminiKey || hasOpenRouterKey;
  const currentLang = VOICE_LANGS.find(l => l.code === voiceLang) ?? VOICE_LANGS[0];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        marginTop: 36,
        padding: 28,
        borderRadius: 20,
        border: "1px solid var(--hairline)",
        background: "rgba(0,0,0,0.22)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10, fontSize: "1.3rem", fontWeight: 600, color: "var(--ink)" }}>
            <MessageSquare size={20} color="var(--accent)" />
            AI Health Assistant
          </h3>
          {hasGeminiKey && (
            <span
              style={{
                fontSize: "0.72rem",
                padding: "2px 8px",
                borderRadius: 10,
                background: "linear-gradient(135deg, rgba(66,133,244,0.15), rgba(52,168,83,0.15))",
                color: "#4285f4",
                fontWeight: 600,
                border: "1px solid rgba(66,133,244,0.3)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Sparkles size={11} /> Gemma 4
            </span>
          )}
        </div>

        {/* Language pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.05)", borderRadius: 20, padding: "4px 8px", border: "1px solid var(--hairline)" }}>
          <Globe size={12} color="var(--ink-4)" />
          {VOICE_LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => setVoiceLang(l.code)}
              style={{
                padding: "3px 10px",
                borderRadius: 14,
                border: "none",
                cursor: "pointer",
                fontSize: "0.78rem",
                fontWeight: voiceLang === l.code ? 700 : 400,
                background: voiceLang === l.code ? "var(--accent)" : "transparent",
                color: voiceLang === l.code ? "#fff" : "var(--ink-3)",
                transition: "all 0.18s",
              }}
            >
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      </div>

      <p style={{ color: "var(--ink-3)", fontSize: "0.88rem", marginBottom: 16 }}>
        Ask in English, Hindi, or Bengali — type or tap the mic to speak.
      </p>

      {/* ── No API key warning ── */}
      {!hasApiKey && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 14, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 10, fontSize: "0.85rem", color: "#d97706" }}>
          <AlertCircle size={15} />
          <span>No AI key set. Go to <strong>Settings</strong> and add your free Google Gemini/Gemma or OpenRouter key.</span>
          <Settings size={13} style={{ marginLeft: "auto", opacity: 0.6 }} />
        </div>
      )}

      {/* ── Chat messages ── */}
      <div
        className="scroll-hide"
        style={{
          maxHeight: 300,
          overflowY: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: "rgba(0,0,0,0.2)",
          border: "1px solid var(--hairline)",
          borderRadius: 14,
          marginBottom: 14,
          minHeight: 120,
        }}
      >
        {chatHistory.length === 0 && (
          <p style={{ color: "var(--ink-4)", textAlign: "center", marginTop: 30, fontSize: "0.88rem", fontStyle: "italic" }}>
            No messages yet — ask about your readings…
          </p>
        )}

        {chatHistory.map((msg, i) => {
          const isUser = msg.sender === "You";
          const isSystem = msg.sender === "System";
          return (
            <div key={i} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "85%",
                  padding: "10px 15px",
                  borderRadius: 14,
                  background: isUser
                    ? "rgba(99,102,241,0.18)"
                    : isSystem
                    ? "rgba(245,158,11,0.1)"
                    : "rgba(255,255,255,0.05)",
                  color: "var(--ink)",
                  border: `1px solid ${isUser ? "rgba(99,102,241,0.3)" : isSystem ? "rgba(245,158,11,0.3)" : "var(--hairline)"}`,
                  borderBottomRightRadius: isUser ? 3 : 14,
                  borderBottomLeftRadius: isUser ? 14 : 3,
                  fontSize: "0.9rem",
                  lineHeight: 1.6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <b style={{ display: "block", fontSize: "0.72rem", color: isUser ? "var(--accent)" : isSystem ? "#d97706" : "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {msg.sender}
                  </b>
                  {!isUser && !isSystem && (
                    <SpeechButton
                      text={msg.text}
                      compact
                      size="sm"
                    />
                  )}
                </div>
                {isUser ? msg.text : renderMarkdown(msg.text)}
              </div>
            </div>
          );
        })}

        {isChatting && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-3)", fontSize: "0.85rem", fontStyle: "italic", marginLeft: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "ai-pulse 1s ease-in-out infinite" }} />
            AI is thinking…
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* ── Live subtitle — shown while mic is on ── */}
      {isListening && (
        <div
          style={{
            marginBottom: 12,
            padding: "11px 16px",
            borderRadius: 12,
            background: "linear-gradient(120deg, rgba(244,63,94,0.1) 0%, rgba(99,102,241,0.1) 100%)",
            border: "1px solid rgba(244,63,94,0.3)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            minHeight: 44,
            transition: "all 0.15s",
          }}
        >
          {/* Animated recording dot */}
          <span style={{ flexShrink: 0, width: 9, height: 9, borderRadius: "50%", background: "#f43f5e", boxShadow: "0 0 0 3px rgba(244,63,94,0.25)", animation: "rec-pulse 0.9s ease-in-out infinite" }} />
          <span style={{ fontSize: "0.92rem", color: liveSubtitle ? "var(--ink)" : "var(--ink-3)", fontStyle: liveSubtitle ? "normal" : "italic", flex: 1 }}>
            {liveSubtitle || "Listening… speak now"}
          </span>
        </div>
      )}

      {/* ── Subtitle linger after mic stops ── */}
      {!isListening && liveSubtitle && (
        <div style={{ marginBottom: 12, padding: "9px 14px", borderRadius: 10, background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.2)", fontSize: "0.87rem", color: "var(--ink-3)", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "var(--accent)" }}>✓</span>
          <span>Captured: </span>
          <span style={{ color: "var(--ink)" }}>{liveSubtitle}</span>
        </div>
      )}

      {/* ── Voice error ── */}
      {voiceError && (
        <div style={{ marginBottom: 12, padding: "9px 14px", background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.28)", borderRadius: 10, fontSize: "0.84rem", color: "#f43f5e", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {voiceError}
        </div>
      )}

      {/* ── Voice not supported warning ── */}
      {!voiceSupported && (
        <div style={{ marginBottom: 12, padding: "9px 14px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 10, fontSize: "0.84rem", color: "#d97706" }}>
          ⚠️ Voice input requires Chrome or Edge. Type your question below.
        </div>
      )}

      {/* ── Input row ── */}
      <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
        {/* Mic button */}
        {voiceSupported && (
          <button
            onClick={toggleVoice}
            title={isListening ? "Stop recording" : `Speak in ${currentLang.label}`}
            style={{
              flexShrink: 0,
              width: 46,
              height: 46,
              borderRadius: "50%",
              border: `1.5px solid ${isListening ? "rgba(244,63,94,0.6)" : "var(--hairline)"}`,
              background: isListening ? "rgba(244,63,94,0.14)" : "rgba(255,255,255,0.05)",
              color: isListening ? "#f43f5e" : "var(--ink-3)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s",
              boxShadow: isListening ? "0 0 14px rgba(244,63,94,0.28)" : "none",
            }}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}

        {/* Text input */}
        <input
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentLang.placeholder}
          disabled={isChatting}
          style={{
            flex: 1,
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid var(--hairline)",
            outline: "none",
            background: "rgba(0,0,0,0.28)",
            color: "var(--ink)",
            fontSize: "0.93rem",
            opacity: isChatting ? 0.6 : 1,
          }}
        />

        {/* Send button */}
        <button
          onClick={sendMessage}
          disabled={isChatting || !chatInput.trim()}
          style={{
            flexShrink: 0,
            padding: "0 20px",
            height: 46,
            borderRadius: 12,
            border: `1px solid var(--accent)`,
            background: isChatting || !chatInput.trim() ? "transparent" : "var(--accent)",
            color: isChatting || !chatInput.trim() ? "var(--ink-3)" : "#fff",
            cursor: isChatting || !chatInput.trim() ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontWeight: 600,
            fontSize: "0.92rem",
            transition: "all 0.2s",
          }}
        >
          <Send size={15} />
          Send
        </button>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes rec-pulse {
          0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 3px rgba(244,63,94,0.25); }
          50% { opacity: 0.7; transform: scale(1.25); box-shadow: 0 0 0 6px rgba(244,63,94,0.1); }
        }
        @keyframes ai-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
};

export default AIAssistantChat;
