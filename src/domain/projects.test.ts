import { describe, expect, it } from 'vitest';
import aliases from '../../config/project-aliases.json';
import { createProjectResolver, type Project } from './projects.js';

// Master identities from the supplied projects.csv, kept as local test fixtures.
const projects: Project[] = [
  { code: 'GBX-01', name: 'Greenbox Garden Benchmark', client: 'Greenbox Garden', budgetIdr: '17000000' },
  { code: 'KMD-02', name: 'Kopi Malam Mini Drama S1', client: 'Kopi Malam', budgetIdr: '56000000' },
  { code: 'GLW-03', name: 'Glowlab Serum Launch', client: 'Glowlab', budgetIdr: '32500000' },
  { code: 'SNJ-04', name: 'Senja Resort Teaser', client: 'Senja Resort', budgetIdr: '64750000' },
  { code: 'BRK-05', name: 'Barakuda Sneakers Lookbook', client: 'Barakuda', budgetIdr: '48750000' },
  { code: 'INT-00', name: 'Internal R&D', client: 'Internal', budgetIdr: '18750000' },
];

describe('T-04: deterministic project resolution', () => {
  const resolve = createProjectResolver(projects, aliases);

  it.each(['KMD-02', 'KMD 02', 'kmd02', ' kMd-02 ', 'KMD\t02'])(
    'normalizes project code %j',
    (label) => {
      expect(resolve(label)).toEqual({ status: 'mapped', projectCode: 'KMD-02', matchedBy: 'code' });
    },
  );

  it('maps every canonical code and full project name', () => {
    for (const project of projects) {
      expect(resolve(project.code)).toEqual({ status: 'mapped', projectCode: project.code, matchedBy: 'code' });
      expect(resolve(project.name)).toEqual({ status: 'mapped', projectCode: project.code, matchedBy: 'name' });
    }
  });

  it('normalizes whitespace and casing in full names', () => {
    expect(resolve('  KOPI   MALAM\tMINI DRAMA S1 ')).toEqual({
      status: 'mapped', projectCode: 'KMD-02', matchedBy: 'name',
    });
  });

  it.each(aliases)('maps explicit alias $alias to $projectCode', ({ alias, projectCode }) => {
    expect(resolve(` ${alias.toUpperCase()} `)).toEqual({ status: 'mapped', projectCode, matchedBy: 'alias' });
  });

  it.each([null, undefined, '', '  ', '\t'])('keeps missing label %j for review', (label) => {
    expect(resolve(label)).toMatchObject({ status: 'needs_review', reason: 'missing_project', candidates: [] });
  });

  it.each(['misc', 'test', 'new client pitch', 'sandbox', 'Greenbok', 'Kopi', 'kopimalam', 123])(
    'does not guess an unknown label %j',
    (label) => {
      expect(resolve(label)).toMatchObject({ status: 'needs_review', reason: 'unknown_project', candidates: [] });
    },
  );

  it('does not coerce arrays or objects to valid project labels', () => {
    for (const label of [['KMD-02'], { toString: () => 'KMD-02' }, Object.create(null)]) {
      expect(resolve(label)).toEqual({ status: 'needs_review', reason: 'unknown_project', label: null, candidates: [] });
    }
  });

  it('reports duplicate aliases with different targets deterministically', () => {
    const conflict = [
      { alias: 'Campaign', projectCode: 'KMD-02' },
      { alias: '  CAMPAIGN ', projectCode: 'GBX-01' },
    ];
    const expected = {
      status: 'needs_review', reason: 'ambiguous_project', label: 'campaign', candidates: ['GBX-01', 'KMD-02'],
    };
    expect(createProjectResolver(projects, conflict)('campaign')).toEqual(expected);
    expect(createProjectResolver([...projects].reverse(), [...conflict].reverse())('campaign')).toEqual(expected);
  });

  it('does not consider duplicate aliases for the same project ambiguous', () => {
    const resolveDuplicate = createProjectResolver(projects, [
      { alias: 'Campaign', projectCode: 'KMD-02' },
      { alias: ' CAMPAIGN ', projectCode: 'KMD-02' },
    ]);
    expect(resolveDuplicate('campaign')).toEqual({ status: 'mapped', projectCode: 'KMD-02', matchedBy: 'alias' });
  });

  it.each(['KMD-02', 'KMD 02', 'kmd02'])('does not let a code silently override a conflicting alias: %s', (label) => {
    const resolveConflict = createProjectResolver(projects, [{ alias: 'KMD-02', projectCode: 'GBX-01' }]);
    expect(resolveConflict(label)).toMatchObject({
      status: 'needs_review', reason: 'ambiguous_project', candidates: ['GBX-01', 'KMD-02'],
    });
  });

  it('does not let an exact full name silently override an alias', () => {
    const resolveConflict = createProjectResolver(projects, [
      { alias: 'Kopi Malam Mini Drama S1', projectCode: 'GBX-01' },
    ]);
    expect(resolveConflict('Kopi Malam Mini Drama S1')).toMatchObject({
      status: 'needs_review', reason: 'ambiguous_project', candidates: ['GBX-01', 'KMD-02'],
    });
  });

  it('detects a name that conflicts with another project code', () => {
    const renamed = projects.map((p) => p.code === 'GBX-01' ? { ...p, name: 'KMD-02' } : p);
    expect(createProjectResolver(renamed, [])('kmd02')).toMatchObject({
      status: 'needs_review', reason: 'ambiguous_project', candidates: ['GBX-01', 'KMD-02'],
    });
  });

  it('detects duplicate names and normalized code collisions', () => {
    const collisions: Project[] = [
      { ...projects[1]!, code: 'KMD-02', name: 'Campaign' },
      { ...projects[0]!, code: 'KMD02', name: ' CAMPAIGN ' },
    ];
    const resolveCollision = createProjectResolver(collisions, []);
    for (const label of ['kmd 02', 'campaign']) {
      expect(resolveCollision(label)).toMatchObject({
        status: 'needs_review', reason: 'ambiguous_project', candidates: ['KMD-02', 'KMD02'],
      });
    }
  });

  it('prefers code then name provenance when all identities agree', () => {
    const resolveRepeated = createProjectResolver(projects, [
      { alias: 'KMD-02', projectCode: 'KMD-02' },
      { alias: 'Kopi Malam Mini Drama S1', projectCode: 'KMD-02' },
    ]);
    expect(resolveRepeated('kmd02')).toMatchObject({ status: 'mapped', matchedBy: 'code' });
    expect(resolveRepeated('Kopi Malam Mini Drama S1')).toMatchObject({ status: 'mapped', matchedBy: 'name' });
  });

  it('rejects aliases targeting a project absent from master data', () => {
    expect(() => createProjectResolver(projects, [{ alias: 'New', projectCode: 'NOPE-99' }])).toThrow(/Unknown project code/);
  });

  it('rejects empty aliases and invalid master identities', () => {
    expect(() => createProjectResolver(projects, [{ alias: ' ', projectCode: 'KMD-02' }])).toThrow(/non-empty alias/);
    expect(() => createProjectResolver([{ ...projects[0]!, code: ' - ' }], [])).toThrow(/non-empty code and name/);
    expect(() => createProjectResolver([{ ...projects[0]!, name: ' ' }], [])).toThrow(/non-empty code and name/);
    expect(() => createProjectResolver([projects[0]!, projects[0]!], [])).toThrow(/Duplicate project code/);
  });
});
