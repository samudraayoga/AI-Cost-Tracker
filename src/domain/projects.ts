export interface Project {
  code: string;
  name: string;
  client: string;
  budgetIdr: string;
}

export interface ProjectAlias {
  alias: string;
  projectCode: string;
}

export type ProjectResolution =
  | {
      status: 'mapped';
      projectCode: string;
      matchedBy: 'code' | 'name' | 'alias';
    }
  | {
      status: 'needs_review';
      reason: 'missing_project' | 'unknown_project' | 'ambiguous_project';
      label: string | null;
      candidates: string[];
    };

export type ProjectResolver = (label: unknown) => ProjectResolution;

type ProjectIndex = Map<string, Set<string>>;

function normalizeName(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeCode(label: string): string {
  return label.replace(/[\s-]+/g, '').toLowerCase();
}

function addToIndex(index: ProjectIndex, key: string, projectCode: string): void {
  const candidates = index.get(key) ?? new Set<string>();
  candidates.add(projectCode);
  index.set(key, candidates);
}

/**
 * Resolve only explicit identities. Code formatting is flexible; names and
 * configured aliases tolerate case and whitespace differences, never fuzzy matches.
 * All matching identities are checked before choosing a project.
 */
export function createProjectResolver(
  projects: Project[],
  aliases: ProjectAlias[],
): ProjectResolver {
  const codes: ProjectIndex = new Map();
  const names: ProjectIndex = new Map();
  const aliasNames: ProjectIndex = new Map();
  const codeClaims: ProjectIndex = new Map();
  const canonicalCodes = new Set<string>();

  for (const project of projects) {
    if (
      typeof project.code !== 'string' ||
      !normalizeCode(project.code) ||
      typeof project.name !== 'string' ||
      !normalizeName(project.name)
    ) {
      throw new Error('Each project must have a non-empty code and name');
    }
    if (canonicalCodes.has(project.code)) {
      throw new Error(`Duplicate project code: ${project.code}`);
    }
    canonicalCodes.add(project.code);
    addToIndex(codes, normalizeCode(project.code), project.code);
    addToIndex(names, normalizeName(project.name), project.code);
  }

  // Names or aliases that look like existing codes must also conflict with all
  // equivalent code spellings (e.g. KMD-02, KMD 02 and kmd02).
  function claimCode(label: string, projectCode: string): void {
    const key = normalizeCode(label);
    if (codes.has(key)) addToIndex(codeClaims, key, projectCode);
  }

  for (const project of projects) claimCode(project.name, project.code);

  for (const entry of aliases) {
    if (
      !entry ||
      typeof entry.alias !== 'string' ||
      !normalizeName(entry.alias) ||
      typeof entry.projectCode !== 'string'
    ) {
      throw new Error('Each project alias must have a non-empty alias and projectCode');
    }
    if (!canonicalCodes.has(entry.projectCode)) {
      throw new Error(`Unknown project code in alias configuration: ${entry.projectCode}`);
    }
    addToIndex(aliasNames, normalizeName(entry.alias), entry.projectCode);
    claimCode(entry.alias, entry.projectCode);
  }

  return (value: unknown): ProjectResolution => {
    // Do not accept an array/object merely because its string representation is
    // a valid project label. Spreadsheet and API adapters must supply a string.
    if (typeof value !== 'string') {
      return {
        status: 'needs_review',
        reason: value == null ? 'missing_project' : 'unknown_project',
        label: typeof value === 'number' || typeof value === 'boolean' ? String(value) : null,
        candidates: [],
      };
    }
    const label = value.trim();
    if (label === '') {
      return { status: 'needs_review', reason: 'missing_project', label, candidates: [] };
    }

    const codeMatches = codes.get(normalizeCode(label));
    const nameMatches = names.get(normalizeName(label));
    const aliasMatches = aliasNames.get(normalizeName(label));
    const candidates = new Set([
      ...(codeMatches ?? []),
      ...(nameMatches ?? []),
      ...(aliasMatches ?? []),
      ...(codeClaims.get(normalizeCode(label)) ?? []),
    ]);

    if (candidates.size !== 1) {
      return {
        status: 'needs_review',
        reason: candidates.size === 0 ? 'unknown_project' : 'ambiguous_project',
        label,
        candidates: [...candidates].sort(),
      };
    }

    return {
      status: 'mapped',
      projectCode: [...candidates][0]!,
      matchedBy: codeMatches?.size ? 'code' : nameMatches?.size ? 'name' : 'alias',
    };
  };
}
