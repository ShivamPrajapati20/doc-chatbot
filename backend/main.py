from fastapi import FastAPI,File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import tempfile, os
from rag import load_pdf, ask_question, stream_answer

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health():
    return {"status": "ok"}

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):

    """Receives a PDF file, processes it, and loads it into ChromaDB."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        chunks = load_pdf(tmp_path)
        return {"status": "ready", "filename": file.filename, "chunks": chunks}
    finally:
        os.unlink(tmp_path)

@app.post("/chat")
async def chat(question: str):
    """Answer a question about uploaded PDF."""
    return ask_question(question)

@app.get("/stream")
def stream(question: str):
    """Stream the answer token by token using Server-Sent Events."""
    return StreamingResponse(
        stream_answer(question),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )