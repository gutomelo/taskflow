/**
 * Nomes exibidos (D12 do design da spec 010): só de quem **ainda é membro** da organização; quem
 * saiu fica fora do mapa e aparece como "Ex-membro". Em lote: uma chamada por resposta.
 */
export interface CollaborationUserDirectory {
  displayNames(
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, string>>;
}
