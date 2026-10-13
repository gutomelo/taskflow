-- CreateEnum
CREATE TYPE "project_role" AS ENUM ('manager', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "status_category" AS ENUM ('todo', 'in_progress', 'done');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(10) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(2000),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "project_role" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_statuses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "category" "status_category" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "workflow_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "from_status_id" UUID NOT NULL,
    "to_status_id" UUID NOT NULL,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("project_id","from_status_id","to_status_id")
);

-- CreateIndex
CREATE INDEX "projects_organization_id_archived_at_name_id_idx" ON "projects"("organization_id", "archived_at", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_id_key" ON "projects"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_key_key" ON "projects"("organization_id", "key");

-- CreateIndex
CREATE INDEX "project_members_organization_id_project_id_created_at_user__idx" ON "project_members"("organization_id", "project_id", "created_at", "user_id");

-- CreateIndex
CREATE INDEX "project_members_organization_id_user_id_idx" ON "project_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_organization_id_project_id_user_id_key" ON "project_members"("organization_id", "project_id", "user_id");

-- CreateIndex
CREATE INDEX "workflow_statuses_organization_id_project_id_position_idx" ON "workflow_statuses"("organization_id", "project_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_statuses_organization_id_project_id_id_key" ON "workflow_statuses"("organization_id", "project_id", "id");

-- CreateIndex
CREATE INDEX "workflow_transitions_organization_id_project_id_to_status_i_idx" ON "workflow_transitions"("organization_id", "project_id", "to_status_id");

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organization_id_project_id_from_statu_fkey" FOREIGN KEY ("organization_id", "project_id", "from_status_id") REFERENCES "workflow_statuses"("organization_id", "project_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organization_id_project_id_to_status__fkey" FOREIGN KEY ("organization_id", "project_id", "to_status_id") REFERENCES "workflow_statuses"("organization_id", "project_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Restrições manuais (spec 003, T2). O domínio valida as regras; o banco protege a integridade.
-- ---------------------------------------------------------------------------------------------

-- BR-025: formato da chave (maiúsculas e dígitos, começando por letra, 2–10).
ALTER TABLE "projects" ADD CONSTRAINT "projects_key_format"
  CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,9}$');

-- Nome já normalizado pelo domínio (texto exibível, 2–80).
ALTER TABLE "projects" ADD CONSTRAINT "projects_name_normalized"
  CHECK (char_length("name") BETWEEN 2 AND 80 AND "name" = btrim("name"));

-- Descrição vazia é gravada como NULL.
ALTER TABLE "projects" ADD CONSTRAINT "projects_description_not_blank"
  CHECK ("description" IS NULL OR btrim("description") <> '');

ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_name_normalized"
  CHECK (char_length("name") BETWEEN 1 AND 40 AND "name" = btrim("name"));

ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_position_non_negative"
  CHECK ("position" >= 0);

-- BR-004: transição liga dois status diferentes (do mesmo projeto, garantido pelas FKs).
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_distinct_statuses"
  CHECK ("from_status_id" <> "to_status_id");
