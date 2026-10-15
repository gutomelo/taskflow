/**
 * Resumo por e-mail (BR-034, decisões 7 e 8): só contagens, chaves e links — nenhum nome de pessoa,
 * título, texto nem nome de organização (o grupo é o slug, de formato restrito).
 */
export type DigestEmail = Readonly<{
  groups: ReadonlyArray<
    Readonly<{
      organizationSlug: string;
      mentions: number;
      assignments: number;
      tasks: ReadonlyArray<Readonly<{ key: string; url: string }>>;
    }>
  >;
  preferencesUrl: string;
}>;

export interface DigestMailer {
  send(to: Readonly<{ email: string; name: string }>, digest: DigestEmail): Promise<void>;
}
