-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- Índice parcial (manual): o relay só consulta eventos ainda não publicados, em ordem.
-- Mantém o índice pequeno mesmo com milhões de eventos publicados aguardando limpeza.
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" ("occurred_at") WHERE "published_at" IS NULL;
