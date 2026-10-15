-- CreateEnum
CREATE TYPE "session_revocation_reason" AS ENUM ('logout', 'user_revoked', 'reuse_detected', 'password_changed', 'password_reset');

-- CreateEnum
CREATE TYPE "user_token_purpose" AS ENUM ('email_verification', 'password_reset');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" "session_revocation_reason",
    "user_agent" VARCHAR(256),
    "ip_prefix" VARCHAR(64),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "grace_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "user_token_purpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_created_at_idx" ON "refresh_tokens"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_source_event_id_key" ON "user_tokens"("source_event_id");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_purpose_consumed_at_idx" ON "user_tokens"("user_id", "purpose", "consumed_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Restrições manuais (não representáveis no schema Prisma; revisadas na spec 001, T9)
-- ---------------------------------------------------------------------------

-- E-mail armazenado sempre normalizado: impede que variações de caixa/espaços burlem o UNIQUE.
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));

-- BR-015: a expiração por inatividade nunca ultrapassa a absoluta.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_idle_within_absolute_check"
  CHECK ("idle_expires_at" <= "absolute_expires_at");

-- Revogação consistente: data e motivo existem juntos.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_revocation_consistency_check"
  CHECK (("revoked_at" IS NULL) = ("revocation_reason" IS NULL));

-- BR-012: no máximo um refresh token atual (não rotacionado) por sessão.
CREATE UNIQUE INDEX "refresh_tokens_one_current_per_session_idx"
  ON "refresh_tokens" ("session_id") WHERE "rotated_at" IS NULL;

-- Tolerância só pode ser usada por token já rotacionado.
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_grace_after_rotation_check"
  CHECK ("grace_used_at" IS NULL OR "rotated_at" IS NOT NULL);

ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_expiration_check"
  CHECK ("expires_at" > "created_at");

-- RF-15: limpeza diária de contas não verificadas consulta apenas este subconjunto.
CREATE INDEX "users_unverified_created_at_idx"
  ON "users" ("created_at") WHERE "email_verified_at" IS NULL;
