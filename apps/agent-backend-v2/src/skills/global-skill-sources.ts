import { resolve } from 'node:path';

export type GlobalSkillSource = {
  rootDir: string;
};

export function buildGlobalSkillSources(skillRoots: string[]): GlobalSkillSource[] {
  const seen = new Set<string>();
  const result: GlobalSkillSource[] = [];

  for (const skillRoot of skillRoots) {
    const resolvedRoot = resolve(skillRoot);
    if (!resolvedRoot || seen.has(resolvedRoot)) {
      continue;
    }
    seen.add(resolvedRoot);
    result.push({ rootDir: resolvedRoot });
  }

  return result;
}
