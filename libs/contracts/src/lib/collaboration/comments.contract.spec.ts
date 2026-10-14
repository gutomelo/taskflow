import {
  commentBodySchema,
  createCommentRequestSchema,
  editCommentRequestSchema,
  embeddedReferences,
} from './comments.contract';

// B1 da segurança: o harness de isolamento só exige a variante `body.mentions` se o campo levar a
// marca. Um `.trim()` ou `.max()` num schema de request criaria outra instância, sem ela.
describe('comments contract (spec 010)', () => {
  it('every comment text in a request carries the embedded references mark', () => {
    for (const field of [
      commentBodySchema,
      createCommentRequestSchema.shape.body,
      editCommentRequestSchema.shape.body,
    ]) {
      expect(embeddedReferences.get(field)).toEqual({ kind: 'mentions' });
    }
  });
});
