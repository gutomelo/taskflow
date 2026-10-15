-- Spec 005 (Kanban). Aditiva. Ajustes manuais documentados em specs/005-kanban/design.md e
-- protegidos por testes de catálogo (tasks-schema.integration.spec.ts, projects-schema):
--   * `board_rank` com COLLATE "C" (ordem ASCII, igual ao domínio) e backfill pelo número;
--   * CHECK de alfabeto e tamanho da chave;
--   * índice único de nome de status sem diferenciar maiúsculas (expressão; o Prisma não o expressa).

-- Workflow com versão própria (BR-008 do workflow).
ALTER TABLE "projects" ADD COLUMN "workflow_version" INTEGER NOT NULL DEFAULT 1;

-- Posição do card (BR-009, ADR 0007/0016): coluna anulável, backfill, depois NOT NULL.
ALTER TABLE "tasks" ADD COLUMN "board_rank" TEXT COLLATE "C";
-- 'e' + 5 dígitos: parte inteira de 5 dígitos (next_number ≤ 10 000), crescente pelo número —
-- a tarefa mais nova fica no fim da coluna (RF-11 da spec 005).
UPDATE "tasks" SET "board_rank" = 'e' || lpad("number"::text, 5, '0');
ALTER TABLE "tasks" ALTER COLUMN "board_rank" SET NOT NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_rank_check"
  CHECK ("board_rank" ~ '^[A-Za-z][0-9A-Za-z]*$' AND char_length("board_rank") BETWEEN 2 AND 64);

-- Coluna do quadro por (rank, id); substitui o índice por status. NÃO único (design, B2).
DROP INDEX "tasks_organization_id_project_id_status_id_idx";
CREATE INDEX "tasks_organization_id_project_id_status_id_board_rank_id_idx"
  ON "tasks"("organization_id", "project_id", "status_id", "board_rank", "id");

-- BR-030: nome de status único no projeto sem diferenciar maiúsculas (defesa no banco; a regra
-- principal é o domínio relendo o workflow sob o lock do projeto).
CREATE UNIQUE INDEX "workflow_statuses_organization_id_project_id_lower_name_key"
  ON "workflow_statuses"("organization_id", "project_id", lower("name"));
