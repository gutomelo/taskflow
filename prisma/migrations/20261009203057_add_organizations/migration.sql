-- CreateEnum
CREATE TYPE "organization_role" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "organization_role" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "organization_role" NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "token_hash" CHAR(64),
    "delivery_event_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "memberships_organization_id_role_idx" ON "memberships"("organization_id", "role");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_created_at_idx" ON "invitations"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Restrições manuais (spec 002, T6). O domínio valida as regras; o banco protege a integridade.
-- ---------------------------------------------------------------------------------------------

-- BR-022: formato do slug (palavras reservadas ficam no domínio).
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_format_check"
  CHECK ("slug" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 40);

-- Nome já normalizado pelo domínio (texto exibível, 2–80).
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_name_length_check"
  CHECK (char_length("name") BETWEEN 2 AND 80 AND "name" = btrim("name"));

-- BR-020: e-mail do convite normalizado (comparado com o e-mail da conta no aceite).
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));

-- BR-021: convites nunca concedem owner.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_not_owner_check"
  CHECK ("role" <> 'owner');

-- Aceito ou revogado, nunca os dois; aceite sempre registra quem aceitou.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_closed_once_check"
  CHECK (NOT ("accepted_at" IS NOT NULL AND "revoked_at" IS NOT NULL));
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_consistent_check"
  CHECK (("accepted_at" IS NULL) = ("accepted_by_user_id" IS NULL));

-- BR-020: um convite aberto (nem aceito nem revogado, ainda que expirado) por e-mail e organização.
CREATE UNIQUE INDEX "invitations_one_open_per_email_idx"
  ON "invitations" ("organization_id", "email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
