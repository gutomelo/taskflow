import {
  InvalidProjectDescriptionError,
  InvalidProjectKeyError,
  InvalidProjectNameError,
  ProjectArchivedError,
} from '../errors';
import { Project } from './project';
import { parseProjectDescription, PROJECT_DESCRIPTION_MAX_LENGTH } from './project-description';
import { ProjectKey } from './project-key';
import { ProjectName } from './project-name';

const NOW = new Date('2026-10-13T10:00:00.000Z');
const LATER = new Date('2026-10-13T11:00:00.000Z');

function project() {
  return Project.create({
    id: 'p-1',
    organizationId: 'org-1',
    key: ProjectKey.create('WEB'),
    name: ProjectName.create('Website'),
    description: null,
    createdByUserId: 'u-1',
    now: NOW,
  });
}

describe('ProjectKey (BR-025)', () => {
  it.each(['WEB', 'AB', 'A1', 'ABCDEFGHIJ', 'Q2025'])('BR-025: accepts %s', (raw) => {
    expect(ProjectKey.create(raw).value).toBe(raw);
  });

  it.each(['web', 'Web', 'A', '1AB', 'ABCDEFGHIJK', 'WE B', 'WÉB', 'WE-B', '', ' WEB'])(
    'BR-025: rejects %j without normalizing it',
    (raw) => {
      expect(() => ProjectKey.create(raw)).toThrow(InvalidProjectKeyError);
      expect(ProjectKey.isValid(raw)).toBe(false);
    },
  );
});

describe('ProjectName', () => {
  it('normalizes display text and enforces 2–80 characters', () => {
    expect(ProjectName.create('  Site   novo ').value).toBe('Site novo');
    expect(() => ProjectName.create('A')).toThrow(InvalidProjectNameError);
    expect(() => ProjectName.create('x'.repeat(81))).toThrow(InvalidProjectNameError);
    expect(() => ProjectName.create('Site‮evil')).toThrow(InvalidProjectNameError);
  });
});

describe('parseProjectDescription', () => {
  it('keeps line breaks, normalizes each line and trims blank edges', () => {
    expect(parseProjectDescription('\n  Objetivo:  lançar \r\n\n- item  um\n\n')).toBe(
      'Objetivo: lançar\n\n- item um',
    );
  });

  it('turns empty or blank descriptions into null', () => {
    expect(parseProjectDescription(null)).toBeNull();
    expect(parseProjectDescription('  \n \n')).toBeNull();
  });

  it('rejects invisible formatting and descriptions over the limit', () => {
    expect(() => parseProjectDescription('ok​')).toThrow(InvalidProjectDescriptionError);
    expect(() => parseProjectDescription('a'.repeat(PROJECT_DESCRIPTION_MAX_LENGTH + 1))).toThrow(
      InvalidProjectDescriptionError,
    );
    expect(parseProjectDescription('a'.repeat(PROJECT_DESCRIPTION_MAX_LENGTH))).toHaveLength(
      PROJECT_DESCRIPTION_MAX_LENGTH,
    );
  });
});

describe('Project', () => {
  it('starts active at version 1', () => {
    const created = project();

    expect(created.isArchived).toBe(false);
    expect(created.toSnapshot()).toMatchObject({ version: 1, archivedAt: null, createdAt: NOW });
  });

  it('updates name and description independently', () => {
    const edited = project();
    edited.update({ description: 'Nova descrição' }, LATER);
    edited.update({ name: ProjectName.create('Portal') }, LATER);

    expect(edited.toSnapshot()).toMatchObject({
      name: ProjectName.create('Portal'),
      description: 'Nova descrição',
      updatedAt: LATER,
    });
  });

  it('BR-026: an archived project is read-only until restored', () => {
    const archived = project();
    expect(archived.archive(LATER)).toBe(true);

    expect(() => archived.update({ description: 'x' }, LATER)).toThrow(ProjectArchivedError);
    expect(archived.restore(LATER)).toBe(true);
    archived.update({ description: 'x' }, LATER);
    expect(archived.toSnapshot().description).toBe('x');
  });

  it('archive and restore are idempotent (report whether something changed)', () => {
    const subject = project();

    expect(subject.restore(LATER)).toBe(false);
    expect(subject.archive(LATER)).toBe(true);
    expect(subject.archive(new Date('2026-10-14T00:00:00.000Z'))).toBe(false);
    expect(subject.toSnapshot().archivedAt).toEqual(LATER);
  });
});
