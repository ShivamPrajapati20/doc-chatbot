"use client";

import { useEffect, useRef, useState } from "react";

interface ChatItem {
  q: string;
  a: string;
  pages: string[];
  createdAt: string;
}

export default function Home() {
  const [status, setStatus] = useState<"idle" | "uploading" | "ready" | "error">("idle");
  const [filename, setFilename] = useState("");
  const [question, setQuestion] = useState("");
  const [activeQuestion, setActiveQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<ChatItem[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, answer, loading]);

  async function uploadFile(file: File) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setFilename("");
    setHistory([]);
    setAnswer("");
    setPages([]);
    setQuestion("");
    setActiveQuestion("");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        throw new Error("Upload failed");
      }

      const data = await res.json();
      setFilename(data.filename ?? file.name);
      setStatus("ready");
    } catch (error) {
      console.error(error);
      setStatus("error");
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  }

  function handleAsk(prefilledQuestion?: string) {
    const finalQuestion = (prefilledQuestion ?? question).trim();
    if (!finalQuestion || status !== "ready" || loading) return;

    setLoading(true);
    setAnswer("");
    setPages([]);
    setActiveQuestion(finalQuestion);
    if (!prefilledQuestion) setQuestion("");

    let fullAnswer = "";
    let finalPages: string[] = [];

    const encoded = encodeURIComponent(finalQuestion);
    const es = new EventSource(`/api/stream?question=${encoded}`);

    es.onmessage = (e: MessageEvent<string>) => {
      fullAnswer += e.data;
      setAnswer(fullAnswer);
    };

    es.addEventListener("citations", (e: Event) => {
      const event = e as MessageEvent<string>;
      const nums = event.data
        .split(",")
        .map((n: string) => n.trim())
        .filter((n: string) => n.length > 0);

      finalPages = nums;
      setPages(nums);
    });

    es.addEventListener("done", () => {
      es.close();
      setLoading(false);

      setHistory((prev) => [
        ...prev,
        {
          q: finalQuestion,
          a: fullAnswer,
          pages: finalPages,
          createdAt: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);

      setAnswer("");
      setPages([]);
      setActiveQuestion("");
    });

    es.onerror = () => {
      es.close();
      setLoading(false);
    };
  }

  function clearChat() {
    setQuestion("");
    setActiveQuestion("");
    setAnswer("");
    setPages([]);
    setHistory([]);
  }

  async function copyText(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1200);
    } catch (error) {
      console.error(error);
    }
  }

  const sampleQuestions = [
    "Summarize this document",
    "What are the main points?",
    "Give me the key takeaways",
    "Explain it in simple words",
  ];

  const fileStatusLabel =
    status === "uploading"
      ? "Processing PDF..."
      : status === "ready"
      ? "Ready to chat"
      : status === "error"
      ? "Something went wrong"
      : "Upload a PDF to begin";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Document Chatbot</h1>
          <p className="mt-2 text-sm text-slate-500">
            Upload a PDF, ask questions, and stream answers with citations.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Upload</h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    status === "ready"
                      ? "bg-emerald-50 text-emerald-700"
                      : status === "uploading"
                      ? "bg-blue-50 text-blue-700"
                      : status === "error"
                      ? "bg-red-50 text-red-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {fileStatusLabel}
                </span>
              </div>

              <label
                className={`block cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${
                  dragging
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-300 bg-slate-50 hover:bg-slate-100"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) uploadFile(file);
                }}
              >
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={handleUpload}
                />
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                  <span className="text-xl">📄</span>
                </div>
                <p className="text-sm font-medium">Drag & drop your PDF</p>
                <p className="mt-1 text-xs text-slate-500">or click to browse</p>
              </label>

              {filename && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-700">Loaded file</p>
                  <p className="mt-1 break-all text-sm text-slate-600">{filename}</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Quick prompts</h2>
                <button
                  onClick={clearChat}
                  className="text-xs font-medium text-red-500 hover:text-red-600"
                >
                  Clear chat
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {sampleQuestions.map((item) => (
                  <button
                    key={item}
                    onClick={() => handleAsk(item)}
                    disabled={status !== "ready" || loading}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold">Previous questions</h2>

              {history.length === 0 ? (
                <p className="text-sm text-slate-400">No questions yet.</p>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {history.map((item, index) => (
                    <button
                      key={`${item.q}-${index}`}
                      onClick={() => setQuestion(item.q)}
                      className="w-full rounded-xl border border-slate-200 p-3 text-left text-sm transition hover:bg-slate-50"
                    >
                      <div className="line-clamp-2">{item.q}</div>
                      <div className="mt-1 text-xs text-slate-400">{item.createdAt}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="flex h-[78vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-sm font-semibold">Chat</p>
              <p className="mt-1 text-xs text-slate-500">
                {status === "ready"
                  ? `Ask anything about ${filename}`
                  : "Upload a document to start chatting"}
              </p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/60 p-4">
              {history.length === 0 && !loading && !answer && (
                <div className="flex h-full items-center justify-center">
                  <div className="max-w-md rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      Your answers will appear here
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                      Try asking for a summary, key points, or specific page details.
                    </p>
                  </div>
                </div>
              )}

              {history.map((item, index) => (
                <div key={`${item.q}-${index}`} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-sm text-white shadow-sm">
                      {item.q}
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-slate-800 shadow-sm border border-slate-200">
                      <p className="whitespace-pre-wrap leading-6">{item.a}</p>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-slate-400">
                          {item.pages.length > 0 && (
                            <span>
                              Source page{item.pages.length > 1 ? "s" : ""}:{" "}
                              {item.pages.join(", ")}
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => copyText(item.a, index)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          {copiedIndex === index ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {(loading || answer) && (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-sm text-white shadow-sm">
                      {activeQuestion}
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
                      <p className="whitespace-pre-wrap leading-6">
                        {answer || "Thinking..."}
                        {loading && <span className="ml-1 animate-pulse">▍</span>}
                      </p>

                      {pages.length > 0 && (
                        <p className="mt-3 text-xs text-slate-400">
                          Source page{pages.length > 1 ? "s" : ""}: {pages.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            <div className="border-t border-slate-200 bg-white p-4">
              <div className="flex gap-3">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAsk();
                    }
                  }}
                  placeholder="Ask a question about the document..."
                  disabled={status !== "ready" || loading}
                  className="min-h-[56px] max-h-36 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100"
                />

                <button
                  onClick={() => handleAsk()}
                  disabled={status !== "ready" || loading || !question.trim()}
                  className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Send"}
                </button>
              </div>

              <p className="mt-2 text-xs text-slate-400">
                Press Enter to send. Use Shift + Enter for a new line.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}