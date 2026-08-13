---
name: AI module architecture
description: How the AI assistant, knowledge base, and draft generation are wired together
---

## Tables
- `knowledge_base` — stores text chunks (sourceType: paste | upload | document)
- `ai_settings` — single-row config (model, systemPrompt)

## Routes (all under /api/ai/)
- GET/PUT /ai/settings — get or upsert the single settings row
- GET /ai/knowledge-base — list entries
- POST /ai/knowledge-base — create entry (JSON body)
- DELETE /ai/knowledge-base/:id — delete
- POST /ai/knowledge-base/import-document/:documentId — pulls title+description from documentsTable
- POST /ai/knowledge-base/upload — multer multipart; pdf-parse for PDFs, utf-8 for text
- POST /ai/ask — SSE streaming Q&A; retrieves relevant KB entries via ILIKE search
- POST /ai/generate-draft — non-streaming; returns { title, content }

## Frontend pages
- /ai-assistant — streaming chat UI (fetch + ReadableStream, no codegen hook for SSE)
- /ai-settings — two tabs: Configuration (model/systemPrompt) | Knowledge Base (list/add/upload/import)

## Key decisions
**Why:** Embeddings API not available via Replit proxy; used ILIKE keyword search for retrieval instead of vector similarity.
**How to apply:** If vector search needed later, enable pgvector extension and switch to drizzle-orm/pg-core vector column.

## OpenAI integration
- Uses @workspace/integrations-openai-ai-server (template copied to lib/)
- Model default: gpt-5.6-terra
- gpt-5+ doesn't support `temperature` param; use `max_completion_tokens` not `max_tokens`
