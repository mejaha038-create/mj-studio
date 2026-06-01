import { useState, useRef, useEffect } from "react";

const GEMINI_MODEL = "gemini-1.5-flash";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function analyzeWithGemini(apiKey, videoBase64, mimeType) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: videoBase64 } },
            {
              text: `أنت محلل فيديو ومونتاج متخصص. حلل هذا الفيديو واستخرج كل العناصر بصيغة JSON فقط بدون أي نص إضافي:

{
  "style": {
    "overall_vibe": "وصف الطابع العام",
    "color_grade": "وصف الألوان والفلاتر",
    "mood": "المزاج العام",
    "pace": "سريع/متوسط/بطيء"
  },
  "texts": [
    {
      "id": 1,
      "content": "النص الموجود في الفيديو",
      "position": "أعلى/أسفل/وسط",
      "timing": "متى يظهر",
      "font_style": "وصف الخط",
      "color": "لون النص"
    }
  ],
  "transitions": [
    {
      "type": "نوع الترانزيشن",
      "timing": "متى يحدث",
      "duration": "مدته"
    }
  ],
  "effects": [
    {
      "name": "اسم التأثير",
      "description": "وصفه",
      "keep": true
    }
  ],
  "audio": {
    "music_style": "نوع الموسيقى",
    "beat_sync": "هل المونتاج متزامن مع البيت؟",
    "sound_effects": ["أي مؤثرات صوتية"]
  },
  "editable_elements": [
    {
      "element": "اسم العنصر",
      "current_value": "القيمة الحالية",
      "type": "text/color/timing/effect",
      "suggestion": "كيف يمكن تخصيصه"
    }
  ],
  "template_summary": "ملخص القالب في جملتين"
}

أرجع JSON فقط بدون markdown أو backticks.`
            }
          ]
        }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.2 }
      })
    }
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Gemini API error");
  }
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return { raw_analysis: raw };
  }
}

async function buildTemplateWithClaude(geminiData, customizations) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: "أنت خبير مونتاج إبداعي محترف. تساعد في استنساخ أساليب الفيديو وتخصيصها.",
      messages: [{
        role: "user",
        content: `بناءً على تحليل الفيديو:\n${JSON.stringify(geminiData, null, 2)}\n\nوالتخصيصات:\n${JSON.stringify(customizations, null, 2)}\n\nأنشئ تقرير قالب مفصل بالعربية مع خطوات تطبيق عملية.`
      }]
    })
  });
  if (!response.ok) throw new Error("Claude API error");
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function chatWithClaude(message, history, templateContext) {
  const system = templateContext
    ? `أنت مساعد مونتاج. لديك هذا التحليل: ${JSON.stringify(templateContext)}. أجب بناءً عليه.`
    : "أنت مساعد مونتاج إبداعي خبير. ساعد في كل ما يخص المونتاج والفيديو.";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system,
      messages: [
        ...history.slice(-6).map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: message }
      ]
    })
  });
  if (!response.ok) throw new Error("Claude API error");
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

function TemplateEditor({ templateData, onApply }) {
  const [fields, setFields] = useState(() => {
    const result = {};
    (templateData?.texts || []).forEach((t, i) => {
      result[`text_${i}`] = { label: `نص ${i + 1}`, value: t.content, original: t.content, type: "text", meta: t };
    });
    (templateData?.editable_elements || []).filter(e => e.type !== "text").forEach((e, i) => {
      result[`effect_${i}`] = { label: e.element, value: e.current_value, original: e.current_value, type: e.type, meta: e };
    });
    return result;
  });

  const update = (key, value) => setFields(p => ({ ...p, [key]: { ...p[key], value } }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#d4a574" }}>✦ محرر القالب</div>

      {templateData?.style && (
        <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 10, letterSpacing: 1 }}>طابع الفيديو</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[["الجو العام", templateData.style.overall_vibe], ["الألوان", templateData.style.color_grade], ["الإيقاع", templateData.style.pace], ["المزاج", templateData.style.mood]].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: "#555" }}>{label}</div>
                <div style={{ fontSize: 13, color: "#c8c0b5", direction: "rtl" }}>{value || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "#666", fontWeight: 700, letterSpacing: 1 }}>العناصر القابلة للتعديل</div>

      {Object.entries(fields).map(([key, field]) => (
        <div key={key} style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, color: "#a09080", direction: "rtl", marginBottom: 6 }}>
            <span style={{ color: "#d4a574" }}>{field.type === "text" ? "Ⓣ " : "◈ "}</span>
            {field.label}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              style={{ flex: 1, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, padding: "8px 12px", color: "#e8e0d5", fontSize: 13, outline: "none", direction: "rtl" }}
              value={field.value}
              onChange={e => update(key, e.target.value)}
              placeholder={field.original}
            />
            {field.value !== field.original && (
              <button style={{ background: "#222", border: "1px solid #333", borderRadius: 6, color: "#888", cursor: "pointer", padding: "0 10px" }} onClick={() => update(key, field.original)}>↩</button>
            )}
          </div>
          {field.meta?.suggestion && (
            <div style={{ fontSize: 11, color: "#666", direction: "rtl", marginTop: 4 }}>💡 {field.meta.suggestion}</div>
          )}
        </div>
      ))}

      {templateData?.effects?.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "#666", fontWeight: 700, letterSpacing: 1 }}>التأثيرات المحفوظة</div>
          {templateData.effects.map((e, i) => (
            <div key={i} style={{ background: "#0a110a", border: "1px solid #1a2a1a", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#8a9a8a", direction: "rtl" }}>
              <span style={{ color: "#4ade80" }}>✓ </span>{e.name} — {e.description}
            </div>
          ))}
        </>
      )}

      <button
        style={{ background: "linear-gradient(135deg,#d4a574,#b07030)", border: "none", borderRadius: 12, padding: 13, color: "#000", fontWeight: 900, fontSize: 15, cursor: "pointer", marginTop: 8 }}
        onClick={() => onApply(fields)}
      >
        ✦ توليد القالب بمعلوماتي
      </button>
    </div>
  );
}

function Bubble({ msg }) {
  const isUser = msg.role === "user";
  const tag = msg.aiTag === "gemini" ? { color: "#4285f4", label: "◆ Gemini" } : msg.aiTag === "claude" ? { color: "#d4a574", label: "◈ Claude" } : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: 4 }}>
      {!isUser && tag && <div style={{ fontSize: 11, fontWeight: 700, color: tag.color, letterSpacing: 1 }}>{tag.label}</div>}
      <div style={{ maxWidth: "85%", background: isUser ? "linear-gradient(135deg,#d4a574,#c08040)" : "#0e0e0e", border: isUser ? "none" : `1px solid ${tag?.color || "#2a2a2a"}`, borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px", padding: "12px 16px", fontSize: 14, lineHeight: 1.8, direction: "rtl", textAlign: "right", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#e8e0d5" }}>
        {msg.video && <video src={msg.video} style={{ width: "100%", borderRadius: 8, marginBottom: 10, maxHeight: 180 }} controls muted />}
        {msg.content}
      </div>
    </div>
  );
}

export default function App() {
  const [geminiKey, setGeminiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState([{ id: 1, role: "assistant", content: "مرحباً! 🎬\n\nأنا MJ Studio — نظام استنساخ المونتاج الذكي.\n\nارفع فيديو بأسلوبك وسأستخرج منه قالباً كاملاً قابلاً للتعديل.\n\nأو تحدث معي مباشرة عن أي شيء يخص المونتاج! 💬" }]);
  const [input, setInput] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [templateData, setTemplateData] = useState(null);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const addMsg = (msg) => setMessages(p => [...p, { id: Date.now() + Math.random(), ...msg }]);

  const handleSend = async () => {
    if (loading || (!input.trim() && !videoFile)) return;
    const userMsg = input.trim() || "حلل هذا الفيديو واستخرج القالب";
    addMsg({ role: "user", content: userMsg, video: videoPreview });
    setInput("");
    setLoading(true);
    const history = messages.filter(m => m.role === "user" || m.role === "assistant");
    try {
      if (videoFile && geminiKey) {
        setLoadingStep("◆ Gemini يحلل الفيديو...");
        const base64 = await fileToBase64(videoFile);
        const result = await analyzeWithGemini(geminiKey, base64, videoFile.type);
        setTemplateData(result);
        addMsg({ role: "assistant", aiTag: "gemini", content: `✅ تم تحليل الفيديو!\n\n📋 ${result.template_summary || "تم استخراج القالب"}\n\n🔤 نصوص: ${result.texts?.length || 0}\n✨ تأثيرات: ${result.effects?.length || 0}\n🎬 ترانزيشن: ${result.transitions?.length || 0}\n\nانتقل لتبويب القالب ↑` });
        setTab("template");
        setVideoFile(null); setVideoPreview(null);
        if (fileRef.current) fileRef.current.value = "";
      } else if (videoFile && !geminiKey) {
        addMsg({ role: "assistant", content: "⚠️ أدخل Gemini API Key أولاً!" });
      } else {
        setLoadingStep("◈ Claude يفكر...");
        const reply = await chatWithClaude(userMsg, history, templateData);
        addMsg({ role: "assistant", aiTag: "claude", content: reply });
      }
    } catch (err) {
      addMsg({ role: "assistant", content: `❌ خطأ: ${err.message}` });
    }
    setLoading(false); setLoadingStep("");
  };

  const handleApply = async (fields) => {
    setLoading(true); setLoadingStep("◈ Claude يبني القالب...");
    try {
      const report = await buildTemplateWithClaude(templateData, fields);
      setTab("chat");
      addMsg({ role: "assistant", aiTag: "claude", content: `✦ القالب جاهز!\n\n${report}` });
    } catch (err) {
      addMsg({ role: "assistant", content: `❌ خطأ: ${err.message}` });
    }
    setLoading(false); setLoadingStep("");
  };

  const S = {
    root: { display: "flex", flexDirection: "column", height: "100vh", background: "#080808", color: "#e8e0d5", fontFamily: "'Segoe UI',system-ui,sans-serif", maxWidth: 820, margin: "0 auto" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid #1a1a1a", background: "#0c0c0c", flexShrink: 0 },
    tabs: { display: "flex", borderBottom: "1px solid #1a1a1a", background: "#0c0c0c", flexShrink: 0 },
    tab: { flex: 1, padding: 10, background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
    tabActive: { color: "#d4a574", borderBottom: "2px solid #d4a574" },
    messages: { flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14 },
    inputBar: { display: "flex", alignItems: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid #141414", background: "#0c0c0c", flexShrink: 0 },
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 26 }}>⚡</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#d4a574" }}>MJ Studio</div>
            <div style={{ fontSize: 11, color: "#555" }}>Gemini × Claude — استنساخ الأسلوب</div>
          </div>
        </div>
        {!keySaved ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input type="password" placeholder="Gemini API Key..." value={geminiKey} onChange={e => setGeminiKey(e.target.value)} onKeyDown={e => e.key === "Enter" && geminiKey && setKeySaved(true)}
              style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, padding: "7px 12px", color: "#e8e0d5", fontSize: 13, width: 190, outline: "none" }} />
            <button onClick={() => geminiKey && setKeySaved(true)} style={{ background: "#d4a574", border: "none", borderRadius: 8, padding: "7px 16px", color: "#000", fontWeight: 800, cursor: "pointer" }}>حفظ</button>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#666", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#4ade80" }}>◆</span> Gemini متصل
            <button onClick={() => setKeySaved(false)} style={{ background: "none", border: "1px solid #333", borderRadius: 6, color: "#666", padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>تغيير</button>
          </div>
        )}
      </div>

      <div style={S.tabs}>
        {[["chat", "💬 المحادثة"], ["template", `✦ القالب${templateData ? " ●" : ""}`]].map(([id, label]) => (
          <button key={id} style={{ ...S.tab, ...(tab === id ? S.tabActive : {}), opacity: id === "template" && !templateData ? 0.4 : 1 }}
            onClick={() => id === "template" ? templateData && setTab(id) : setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "chat" ? (
        <>
          <div style={S.messages}>
            {messages.map(m => <Bubble key={m.id} msg={m} />)}
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px" }}>
                <div style={{ display: "flex", gap: 5 }}>
                  {[0, 0.2, 0.4].map((d, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#d4a574", display: "inline-block", animation: `bounce 0.8s ${d}s infinite` }} />)}
                </div>
                <span style={{ fontSize: 13, color: "#555" }}>{loadingStep}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {videoPreview && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#111", borderTop: "1px solid #1a1a1a" }}>
              <video src={videoPreview} style={{ width: 52, height: 34, borderRadius: 6, objectFit: "cover" }} muted />
              <span style={{ fontSize: 12, color: "#666", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{videoFile?.name}</span>
              <button onClick={() => { setVideoFile(null); setVideoPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 17 }}>✕</button>
            </div>
          )}
          <div style={S.inputBar}>
            <button onClick={() => fileRef.current?.click()} style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10, padding: "9px 13px", cursor: "pointer", fontSize: 17 }}>🎬</button>
            <input ref={fileRef} type="file" accept="video/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) { setVideoFile(f); setVideoPreview(URL.createObjectURL(f)); } }} />
            <textarea style={{ flex: 1, background: "#141414", border: "1px solid #222", borderRadius: 12, padding: "10px 14px", color: "#e8e0d5", fontSize: 14, resize: "none", outline: "none", fontFamily: "inherit", direction: "rtl", lineHeight: 1.6 }}
              placeholder="اكتب سؤالك أو ارفع فيديو..." value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} rows={1} />
            <button onClick={handleSend} disabled={loading} style={{ background: "linear-gradient(135deg,#d4a574,#b07030)", border: "none", borderRadius: 10, width: 42, height: 42, color: "#000", fontWeight: 900, fontSize: 19, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>↑</button>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {templateData ? <TemplateEditor templateData={templateData} onApply={handleApply} /> : <div style={{ textAlign: "center", color: "#444", marginTop: 80 }}>ارفع فيديو أولاً</div>}
        </div>
      )}
    </div>
  );
                     }
