-- Spec 010 (comentários e menções). Aditiva. Ajustes manuais documentados em
-- specs/010-comments/design.md e protegidos por teste de catálogo
-- (collaboration-schema.integration.spec.ts):
--   * CHECK de coerência da exclusão lógica (texto nulo ⇔ removido, D4);
--   * CHECK de tamanho do texto em code points (BR-031; o domínio é a regra principal).

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_mentions" (
    "organization_id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "comment_mentions_pkey" PRIMARY KEY ("organization_id","comment_id","user_id")
);

-- CreateIndex
CREATE INDEX "comments_organization_id_task_id_created_at_id_idx" ON "comments"("organization_id", "task_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "comments_organization_id_id_key" ON "comments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "comment_mentions_organization_id_user_id_idx" ON "comment_mentions"("organization_id", "user_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_project_id_task_id_fkey" FOREIGN KEY ("organization_id", "project_id", "task_id") REFERENCES "tasks"("organization_id", "project_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_organization_id_comment_id_fkey" FOREIGN KEY ("organization_id", "comment_id") REFERENCES "comments"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- D4: texto nulo ⇔ removido; BR-031: 1–5 000 caracteres (char_length conta code points).
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_body_check"
  CHECK (("body" IS NULL) = ("deleted_at" IS NOT NULL));
ALTER TABLE "comments" ADD CONSTRAINT "comments_body_length_check"
  CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 5000);
