-- Spec 008 (notificações). Aditiva. Ajustes manuais documentados em
-- specs/008-notifications/design.md e protegidos por teste de catálogo
-- (notifications-schema.integration.spec.ts):
--   * índices parciais do contador (não lidas, com INCLUDE) e do resumo (não lidas e não enviadas);
--   * CHECK: só menções têm comentário.

-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('mention', 'assignment');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "kind" "notification_kind" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "comment_id" UUID,
    "dedupe_key" TEXT NOT NULL,
    "source_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "emailed_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "email_digest" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "notifications_organization_id_recipient_user_id_occurred_at_idx" ON "notifications"("organization_id", "recipient_user_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_organization_id_project_id_task_id_idx" ON "notifications"("organization_id", "project_id", "task_id");

-- CreateIndex
CREATE INDEX "notifications_occurred_at_idx" ON "notifications"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organization_id_recipient_user_id_dedupe_key_key" ON "notifications"("organization_id", "recipient_user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_recipient_user_id_fkey" FOREIGN KEY ("organization_id", "recipient_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_project_id_task_id_fkey" FOREIGN KEY ("organization_id", "project_id", "task_id") REFERENCES "tasks"("organization_id", "project_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- Contador de não lidas (curto-circuito e as 200 mais recentes, só pelo índice).
CREATE INDEX "notifications_unread_idx" ON "notifications"("organization_id", "recipient_user_id", "occurred_at" DESC)
  INCLUDE ("task_id", "comment_id", "kind") WHERE "read_at" IS NULL;

-- Resumo por e-mail: candidatas por pessoa (não lidas e não enviadas).
CREATE INDEX "notifications_digest_idx" ON "notifications"("recipient_user_id", "occurred_at")
  WHERE "read_at" IS NULL AND "emailed_at" IS NULL;

-- Só menções apontam para um comentário.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_kind_check"
  CHECK (("kind" = 'mention') = ("comment_id" IS NOT NULL));
