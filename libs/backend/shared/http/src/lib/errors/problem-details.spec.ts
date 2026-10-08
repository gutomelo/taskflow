import request from 'supertest';
import { z } from 'zod';
import { DomainError } from '@taskflow/backend/shared/kernel';
import { problemDetailsSchema } from '@taskflow/contracts';
import { createTestApp } from '../testing/test-app';
import { parseBody } from '../validation/parse-body';
import { HttpError } from './http-error';
import { notFoundHandler } from './problem-details';

class TaskHasPendingSubtasksError extends DomainError {
  readonly code = 'TASK_HAS_PENDING_REQUIRED_SUBTASKS';
  constructor() {
    super('Task has pending required subtasks');
  }
}

class UnmappedRuleError extends DomainError {
  readonly code = 'UNMAPPED_RULE';
  constructor() {
    super('Internal detail that must not leak');
  }
}

const registerSchema = z.strictObject({ email: z.email(), name: z.string().min(1) });

function buildApp() {
  return createTestApp(
    (app) => {
      app.get('/mapped', () => {
        throw new TaskHasPendingSubtasksError();
      });
      app.get('/unmapped', () => {
        throw new UnmappedRuleError();
      });
      app.get('/busy', () => {
        throw new HttpError(503, 'SERVICE_BUSY', 'Serviço ocupado', { retryAfterSeconds: 3 });
      });
      app.get('/crash', () => {
        throw new Error('SELECT * FROM users -- internal');
      });
      app.post('/register', (req, res) => {
        res.json(parseBody(req, registerSchema));
      });
      app.use(notFoundHandler);
    },
    {
      domainErrors: {
        TASK_HAS_PENDING_REQUIRED_SUBTASKS: {
          status: 409,
          title: 'Há subtarefas obrigatórias pendentes',
        },
      },
    },
  );
}

describe('error handling', () => {
  it('maps registered domain errors to their status and pt-BR title', async () => {
    const response = await request(buildApp()).get('/mapped').expect(409);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(problemDetailsSchema.parse(response.body)).toMatchObject({
      code: 'TASK_HAS_PENDING_REQUIRED_SUBTASKS',
      title: 'Há subtarefas obrigatórias pendentes',
    });
  });

  it('defaults unmapped domain errors to 422 without leaking the technical message', async () => {
    const response = await request(buildApp()).get('/unmapped').expect(422);

    expect(response.body.code).toBe('UNMAPPED_RULE');
    expect(response.text).not.toContain('Internal detail');
  });

  it('sends Retry-After for HTTP errors that define it', async () => {
    const response = await request(buildApp()).get('/busy').expect(503);

    expect(response.headers['retry-after']).toBe('3');
  });

  it('hides unexpected errors behind a generic 500 with the request id', async () => {
    const response = await request(buildApp()).get('/crash').expect(500);

    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.requestId).toBeDefined();
    expect(response.text).not.toContain('SELECT');
  });

  it('never echoes the query string (which may carry tokens) in the instance field', async () => {
    const response = await request(buildApp()).get('/missing?token=secret-link-token').expect(404);

    expect(response.body.instance).toBe('/missing');
    expect(response.text).not.toContain('secret-link-token');
  });
});

describe('body parser errors', () => {
  it('maps malformed JSON to 400 MALFORMED_JSON', async () => {
    const response = await request(buildApp())
      .post('/register')
      .set('content-type', 'application/json')
      .send('{"email":')
      .expect(400);

    expect(response.body.code).toBe('MALFORMED_JSON');
  });

  it('maps oversized payloads to 413 PAYLOAD_TOO_LARGE', async () => {
    const response = await request(buildApp())
      .post('/register')
      .send({ email: 'ana@exemplo.com', name: 'x'.repeat(200_000) })
      .expect(413);

    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('parseBody', () => {
  it('returns the typed, validated body', async () => {
    const response = await request(buildApp())
      .post('/register')
      .send({ email: 'ana@exemplo.com', name: 'Ana' })
      .expect(200);

    expect(response.body).toEqual({ email: 'ana@exemplo.com', name: 'Ana' });
  });

  it('rejects invalid and unknown fields with violations that do not echo values', async () => {
    const response = await request(buildApp())
      .post('/register')
      .send({ email: 'not-an-email-PII', name: '', isAdmin: true })
      .expect(400);

    const problem = problemDetailsSchema.parse(response.body);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.violations?.map(({ field }) => field).sort()).toEqual([
      '(body)',
      'email',
      'name',
    ]);
    expect(response.text).not.toContain('not-an-email-PII');
  });
});
