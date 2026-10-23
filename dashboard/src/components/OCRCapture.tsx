import { useState } from "react";
import { getOpenRouterKey } from "../utils/aiPreferences";
import { getGeminiKey, extractVitalsWithGemma } from "../utils/gemmaClient";
import { SpeechButton } from "./ui";

interface Props { onExtracted: (text: string) => void; }

// Vision-capable model routed via OpenRouter
const OCR_MODEL = "google/gemini-2.0-flash-001";

export default function OCRCapture({ onExtracted }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState("");
  const [error, setError]       = useState("");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64  = dataUrl.split(",")[1];
      setPreview(dataUrl);
      setLoading(true);
      setError("");
      setResult("");

      try {
        const geminiKey = getGeminiKey();
        if (geminiKey) {
          try {
            const extracted = await extractVitalsWithGemma(base64, file.type || 'image/jpeg');
            if (extracted && extracted.trim()) {
              setResult(extracted.trim());
              onExtracted(extracted.trim());
              setLoading(false);
              return;
            }
          } catch (gemmaErr) {
            console.warn("[GemmaOCR] Gemma 4 OCR threw error, trying OpenRouter fallback:", gemmaErr);
          }
        }

        const apiKey = getOpenRouterKey();
        if (!apiKey && !geminiKey) {
          throw new Error("No AI key found. Please add your Google Gemini/Gemma or OpenRouter key in Settings.");
        }

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": window.location.origin,
            "X-Title": "Anebilin OCR",
          },
          body: JSON.stringify({
            model: OCR_MODEL,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Extract all numeric vital sign values from this medical monitor image. List them as:\nHeart Rate: X bpm\nSpO2: X%\nBlood Pressure: X/X mmHg\nHemoglobin: X g/dL\nBilirubin: X mg/dL\n\nOnly include values clearly visible in the image. If a value is not present, omit it.",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${file.type};base64,${base64}`,
                    },
                  },
                ],
              },
            ],
            max_tokens: 300,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error((errJson as any)?.error?.message ?? `API error ${res.status}`);
        }

        const json = await res.json();
        const text: string =
          json.choices?.[0]?.message?.content ?? "No values found.";
        setResult(text);
        onExtracted(text);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "16px 20px", background: "#f8fafc" }}>
      <p style={{ fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        📷 OCR Vital Extraction <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: 10, background: "linear-gradient(135deg, rgba(66,133,244,0.15), rgba(52,168,83,0.15))", color: "#4285f4", fontWeight: 600 }}>✨ Powered by Gemma 4 Vision</span>
      </p>
      <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
        Photograph a bedside vital monitor or clinical prescription slip to automatically extract readings using Gemma 4.
      </p>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ fontSize: 13, marginBottom: 12 }}
      />
      {preview && (
        <img src={preview} alt="preview" style={{ maxHeight: 120, borderRadius: 8, marginBottom: 10, display: "block" }} />
      )}
      {loading && (
        <p style={{ fontSize: 13, color: "#4285f4", display: "flex", alignItems: "center", gap: 6 }}>
          ⏳ Analyzing image with Gemma 4 Multimodal Vision…
        </p>
      )}
      {result && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>Extracted Clinical Vitals</span>
            <SpeechButton text={result} label="Listen to Extracted Vitals" size="sm" />
          </div>
          <pre style={{ fontSize: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap", margin: 0 }}>
            {result}
          </pre>
        </div>
      )}
      {error && (
        <p style={{ color: "#dc2626", fontSize: 12 }}>⚠️ {error}</p>
      )}
    </div>
  );
}
