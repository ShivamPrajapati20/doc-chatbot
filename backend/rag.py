import os
import uuid
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_anthropic import ChatAnthropic
from langchain_classic.chains import ConversationalRetrievalChain
from langchain_community.chat_message_histories import ChatMessageHistory
from dotenv import load_dotenv
from typing import Generator
from anthropic import Anthropic

load_dotenv()

CHROMA_DIR  = "./chroma_db"
EMBED_MODEL = "all-MiniLM-L6-v2"

vectorstore = None
chat_history = None
current_collection = None

def _get_chain():
    llm = ChatAnthropic(model="claude-haiku-4-5-20251001",max_tokens=500)
    return ConversationalRetrievalChain.from_llm(
        llm = llm,
        retriever=vectorstore.as_retriever(search_kargs={"k":3}),
        return_source_documents=True
    )

def _build_history_tuples() -> list:
    """
        Convert ChatMessageHistory messages into (human, ai) tuples.
        ConversationalRetrievalChain expects this format for chat_history.
        Keep last 5 exchanges (10 messages) to control cost.
    """
    msgs   = chat_history.messages[-10:]  # last 5 exchanges
    tuples = []
    for i in range(0, len(msgs) - 1, 2):
        if i + 1 < len(msgs):
            tuples.append((msgs[i].content, msgs[i + 1].content))
    return tuples

def load_pdf(pdf_path: str) -> int:
    """
        Load a PDF into ChromaDB.
        Wipes any existing data first so each upload is fresh.
        Returns the number of chunks created.
    """
    global vectorstore, chat_history, current_collection

    # Load and chunk the PDF
    docs   = PyPDFLoader(pdf_path).load()
    chunks = RecursiveCharacterTextSplitter(
        chunk_size=500, chunk_overlap=50
    ).split_documents(docs)

    # Embed and store in ChromaDB
    embeddings  = HuggingFaceEmbeddings(model_name=EMBED_MODEL)

    os.makedirs(CHROMA_DIR, exist_ok=True)

    if vectorstore is not None and current_collection is not None:
        try:
            vectorstore.delete_collection()
        except Exception:
            pass

    current_collection = f"pdf_{uuid.uuid4().hex}"

    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_DIR,
        collection_name=current_collection,
    )
    
    chat_history = ChatMessageHistory()
    return len(chunks)

def ask_question(question: str) -> dict:
    """
        Answer a question using the loaded PDF.
        Returns answer text and page citations.
    """
    if vectorstore is None:
        return {"answer": "Please upload a PDF first.", "pages": []}

    chain  = _get_chain()
    result = chain.invoke({
        "question":    question,
        "chat_history": _build_history_tuples()
    })

    answer = result["answer"]
    pages  = sorted(set(
        d.metadata.get("page", 0) + 1
        for d in result["source_documents"]
    ))

    # Save this exchange to history
    chat_history.add_user_message(question)
    chat_history.add_ai_message(answer)

    return {"answer": answer, "pages": pages}

anthropic_client = Anthropic()

def stream_answer(question: str) -> Generator[str, None, None]:
    """
        Stream the answer token by token using Server-Sent Events format.
        Yields each token as:  data: token\n\n
        At the end, yields page citations and a done event.
    """
    if vectorstore is None:
        yield "data: Please upload a PDF first.\n\n"
        yield "event: done\ndata: \n\n"
        return

    # Step 1: search ChromaDB for relevant chunks
    docs    = vectorstore.similarity_search(question, k=3)
    context = "\n\n".join([d.page_content for d in docs])
    pages   = sorted(set(d.metadata.get("page", 0) + 1 for d in docs))

    # Step 2: build conversation history string
    history_text = ""
    for human, ai in _build_history_tuples():
        history_text += f"Human: {human}\nAssistant: {ai}\n"

    # Step 3: stream from Claude using raw Anthropic SDK
    system_prompt = """Answer using ONLY the context provided.
    If the answer is not in the context say: I could not find that in the document.
    Be concise and clear."""

    user_message = f"""Previous conversation:
    {history_text}

    Context from document:
    {context}

    Question: {question}"""

    full_answer = ""

    with anthropic_client.messages.stream(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}]
    ) as stream:
        for token in stream.text_stream:
            full_answer += token
            # SSE format — frontend EventSource reads this
            yield f"data: {token}\n\n"

    # Save to memory after streaming is done
    chat_history.add_user_message(question)
    chat_history.add_ai_message(full_answer)

    # Send page citations as a special SSE event
    pages_str = ", ".join(str(p) for p in pages)
    yield f"event: citations\ndata: {pages_str}\n\n"
    yield "event: done\ndata: \n\n"