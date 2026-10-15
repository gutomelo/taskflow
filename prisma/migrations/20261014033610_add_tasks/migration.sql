-- CreateEnum
CREATE TYPE "task_priority" AS ENUM ('none', 'low', 'medium', 'high', 'urgent');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000),
    "status_id" UUID NOT NULL,
    "priority" "task_priority" NOT NULL DEFAULT 'none',
    "assignee_user_id" UUID,
    "due_date" DATE,
    "parent_task_id" UUID,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "blocked_task_id" UUID NOT NULL,
    "blocking_task_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("project_id","blocked_task_id","blocking_task_id")
);

-- CreateTable
CREATE TABLE "task_counters" (
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "next_number" INTEGER NOT NULL,

    CONSTRAINT "task_counters_pkey" PRIMARY KEY ("organization_id","project_id")
);

-- CreateTable
CREATE TABLE "task_project_locks" (
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,

    CONSTRAINT "task_project_locks_pkey" PRIMARY KEY ("organization_id","project_id")
);

-- CreateIndex
CREATE INDEX "tasks_organization_id_project_id_parent_task_id_number_idx" ON "tasks"("organization_id", "project_id", "parent_task_id", "number");

-- CreateIndex
CREATE INDEX "tasks_organization_id_assignee_user_id_idx" ON "tasks"("organization_id", "assignee_user_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_project_id_status_id_idx" ON "tasks"("organization_id", "project_id", "status_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organization_id_project_id_id_key" ON "tasks"("organization_id", "project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organization_id_project_id_number_key" ON "tasks"("organization_id", "project_id", "number");

-- CreateIndex
CREATE INDEX "task_dependencies_organization_id_project_id_blocking_task__idx" ON "task_dependencies"("organization_id", "project_id", "blocking_task_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_project_id_status_id_fkey" FOREIGN KEY ("organization_id", "project_id", "status_id") REFERENCES "workflow_statuses"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey (editada à mão: `SET NULL (assignee_user_id)` — o Prisma não representa a lista de
-- colunas; sem ela `organization_id` seria anulado. Protegida por teste de catálogo, design da spec 004.)
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_assignee_user_id_fkey" FOREIGN KEY ("organization_id", "assignee_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE SET NULL ("assignee_user_id") ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_project_id_parent_task_id_fkey" FOREIGN KEY ("organization_id", "project_id", "parent_task_id") REFERENCES "tasks"("organization_id", "project_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_project_id_blocked_task__fkey" FOREIGN KEY ("organization_id", "project_id", "blocked_task_id") REFERENCES "tasks"("organization_id", "project_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_project_id_blocking_task_fkey" FOREIGN KEY ("organization_id", "project_id", "blocking_task_id") REFERENCES "tasks"("organization_id", "project_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task_counters" ADD CONSTRAINT "task_counters_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task_project_locks" ADD CONSTRAINT "task_project_locks_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Restrições manuais (spec 004, T2). O domínio valida as regras; o banco protege a integridade.
-- ---------------------------------------------------------------------------------------------

-- BR-028: números a partir de 1.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_number_positive" CHECK ("number" >= 1);
ALTER TABLE "task_counters" ADD CONSTRAINT "task_counters_next_number_positive" CHECK ("next_number" >= 1);

-- Título já normalizado pelo domínio (texto exibível, 1–200).
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_normalized"
  CHECK (char_length("title") BETWEEN 1 AND 200 AND "title" = btrim("title"));

-- Descrição vazia é gravada como NULL.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_description_not_blank"
  CHECK ("description" IS NULL OR btrim("description") <> '');

-- "Obrigatória" só existe em subtarefa; subtarefa não é pai de si mesma.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_required_only_for_subtasks"
  CHECK (NOT "is_required" OR "parent_task_id" IS NOT NULL);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_not_own_parent"
  CHECK ("parent_task_id" IS NULL OR "parent_task_id" <> "id");

-- Conclusão e cancelamento registram quem, juntos.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completion_consistent"
  CHECK (("completed_at" IS NULL) = ("completed_by_user_id" IS NULL));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cancellation_consistent"
  CHECK (("canceled_at" IS NULL) = ("canceled_by_user_id" IS NULL));

-- BR-006: dependência liga duas tarefas diferentes.
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_distinct_tasks"
  CHECK ("blocked_task_id" <> "blocking_task_id");
