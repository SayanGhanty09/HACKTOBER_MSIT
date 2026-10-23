// Phase 4: Web Speech API voice input for vital logging
import { useState, useRef } from "react";

interface ParsedVitals { hr?: number; spo2?: number; bpSys?: number; bpDia?: number; }

function parseVitals(text: string): ParsedVitals {
  const t = text.toLowerCase();
  const result: ParsedVitals = {};
  const hr = t.match(/(?:heart rate|pulse)[^\d]*(\d+)/);
  if (hr) result.hr = +hr[1];
  const spo2 = t.match(/(?:oxygen|spo2|saturation)[^\d]*(\d+)/);
  if (spo2) result.spo2 = +spo2[1];
  const bp = t.match(/(\d+)\s*(?:over|\/)\s*(\d+)/);
  if (bp) { result.bpSys = +bp[1]; result.bpDia = +bp[2]; }
  return result;
}

interface Props { onVitals: (vitals: ParsedVitals) => void; lang?: string; }

export default function VoiceInput({ onVitals, lang = "en-IN" }: Props) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [parsed, setParsed]   = useState<ParsedVitals>({});
  const [error, setError]     = useState("");
  const recRef = useRef<any>(null);

  const SpeechRec = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

  const start = () => {
    if (!SpeechRec) { setError("Speech recognition not supported in this browser."); return; }
    const rec = new SpeechRec();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setTranscript(text);
      const vitals = parseVitals(text);
      setParsed(vitals);
      onVitals(vitals);
    };
    rec.onerror = (e: any) => {
      console.error("Voice input error:", e);
      if (e.error === "not-allowed") {
        setError("Microphone access blocked. Please allow mic permission in your browser URL bar.");
      } else if (e.error === "no-speech") {
        setError("No speech detected. Please speak clearly into your microphone.");
      } else if (e.error === "network") {
        setError("Network error: Chrome Speech Recognition requires an internet connection.");
      } else {
        setError(`Speech error: ${e.error}. Please try again.`);
      }
    };
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
    setError("");
  };
  const stop = () => { recRef.current?.stop(); setListening(false); };

  return (
    <div style={{ border:"1.5px solid #e2e8f0", borderRadius:12, padding:"16px 20px", background:"#f8fafc" }}>
      <p style={{ fontWeight:600, marginBottom:10 }}>🎙 Voice Vital Entry</p>
      <div style={{ display:"flex", gap:10, marginBottom:12 }}>
        <button onClick={listening ? stop : start}
          style={{ padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600,
            background: listening ? "#ef4444" : "#6366f1", color:"#fff" }}>
          {listening ? "⏹ Stop" : "🎤 Start"}
        </button>
        {listening && <span style={{ color:"#6366f1", fontStyle:"italic", fontSize:13 }}>Listening…</span>}
      </div>
      {transcript && <p style={{ fontSize:13, color:"#475569", marginBottom:6 }}>Heard: <em>"{transcript}"</em></p>}
      {Object.keys(parsed).length > 0 && (
        <div style={{ fontSize:13, background:"#f0fdf4", border:"1px solid #86efac", borderRadius:8, padding:"8px 12px" }}>
          Parsed: {Object.entries(parsed).map(([k,v])=>`${k}=${v}`).join(" · ")}
        </div>
      )}
      {error && <p style={{ color:"#dc2626", fontSize:12, marginTop:6 }}>{error}</p>}
    </div>
  );
}
