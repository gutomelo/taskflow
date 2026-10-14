import {
  activeQuery,
  applyEdit,
  deserialize,
  EMPTY_DRAFT,
  insertMention,
  serialize,
  serializedLength,
  type MentionDraft,
} from './mention-text';

const MIA = '0192a000-0000-7000-8000-00000000a1a1';
const CAIO = '0192a000-0000-7000-8000-00000000c1c1';
const GONE = '0192a000-0000-7000-8000-00000000d1d1';

/** "Oi @Mia e @Caio" com os dois intervalos. */
const draft: MentionDraft = {
  text: 'Oi @Mia e @Caio',
  ranges: [
    { start: 3, end: 7, userId: MIA },
    { start: 10, end: 15, userId: CAIO },
  ],
};

describe('mention text (I7 of the architecture review)', () => {
  it('serializes ranges as tokens and counts the serialized length', () => {
    expect(serialize(draft)).toBe(`Oi <@${MIA}> e <@${CAIO}>`);
    expect(serializedLength(draft)).toBe(`Oi <@${MIA}> e <@${CAIO}>`.length);
    expect(serializedLength({ text: '😀', ranges: [] })).toBe(1);
    expect(serialize(EMPTY_DRAFT)).toBe('');
  });

  it('deserializes known tokens to names (ex-members too); unknown tokens stay text', () => {
    const unknown = '0192a000-0000-7000-8000-00000000eeee';
    expect(
      deserialize(`Oi <@${MIA.toUpperCase()}> e <@${GONE}> <@${unknown}>`, [
        { userId: MIA, name: 'Mia' },
        { userId: GONE, name: null },
      ]),
    ).toEqual({
      text: `Oi @Mia e @Ex-membro <@${unknown}>`,
      ranges: [
        { start: 3, end: 7, userId: MIA },
        { start: 10, end: 20, userId: GONE },
      ],
    });
    expect(serialize(deserialize(`Oi <@${MIA}>`, [{ userId: MIA, name: 'Mia' }]))).toBe(
      `Oi <@${MIA}>`,
    );
  });

  it('typing before a mention shifts it; after it keeps it; inside it undoes it', () => {
    expect(applyEdit(draft, 'Olá, Oi @Mia e @Caio').ranges).toEqual([
      { start: 8, end: 12, userId: MIA },
      { start: 15, end: 20, userId: CAIO },
    ]);
    expect(applyEdit(draft, 'Oi @Mia e @Caio!').ranges).toEqual(draft.ranges);
    // Digitar exatamente no início de uma menção a empurra, sem desfazê-la.
    expect(applyEdit(draft, 'Oi x@Mia e @Caio').ranges).toEqual([
      { start: 4, end: 8, userId: MIA },
      { start: 11, end: 16, userId: CAIO },
    ]);
    expect(applyEdit(draft, 'Oi @Mia e @Cai').ranges).toEqual([draft.ranges[0]]);
    expect(applyEdit(draft, 'Oi @Mxia e @Caio').ranges).toEqual([
      { start: 11, end: 16, userId: CAIO },
    ]);
    expect(applyEdit(draft, '').ranges).toEqual([]);
  });

  it('a pasted literal token is plain text', () => {
    const pasted = applyEdit(EMPTY_DRAFT, `<@${MIA}>`);
    expect(pasted.ranges).toEqual([]);
    expect(serialize(pasted)).toBe(`<@${MIA}>`);
  });

  it('inserts a mention over the typed query, shifting later mentions, and puts the caret after it', () => {
    const typed = applyEdit(draft, 'Oi @Mia e @Caio @ca');
    const { draft: next, caret } = insertMention(typed, 16, 19, { userId: GONE, name: 'Carla' });
    expect(next.text).toBe('Oi @Mia e @Caio @Carla ');
    expect(caret).toBe(23);
    expect(serialize(next)).toBe(`Oi <@${MIA}> e <@${CAIO}> <@${GONE}> `);

    const before = insertMention(
      { text: '@b e @Caio', ranges: [{ start: 5, end: 10, userId: CAIO }] },
      0,
      2,
      {
        userId: MIA,
        name: 'Mia',
      },
    );
    expect(before.draft.ranges).toEqual([
      { start: 0, end: 4, userId: MIA },
      { start: 8, end: 13, userId: CAIO },
    ]);
  });

  it('finds the query being typed after "@" at the start or after a space, never inside a mention', () => {
    expect(activeQuery({ text: 'Oi @ca', ranges: [] }, 6)).toEqual({ start: 3, query: 'ca' });
    expect(activeQuery({ text: '@ca', ranges: [] }, 3)).toEqual({ start: 0, query: 'ca' });
    expect(activeQuery({ text: 'mail@ca', ranges: [] }, 7)).toBeNull();
    expect(activeQuery({ text: 'Oi @', ranges: [] }, 4)).toBeNull();
    expect(activeQuery({ text: 'Oi @ca x', ranges: [] }, 8)).toBeNull();
    expect(activeQuery({ text: `Oi @${'a'.repeat(51)}`, ranges: [] }, 55)).toBeNull();
    expect(activeQuery(draft, 7)).toBeNull();
    expect(activeQuery({ text: 'Oi @ca e', ranges: [] }, 6)).toEqual({ start: 3, query: 'ca' });
  });
});
