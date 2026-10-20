/**
 * The repo's own policy settings, from `.github/pr-policy.yml` on the **base**
 * branch. pr-policy and pr-lifecycle both read this one file, so the UAT
 * setting can't differ between the label writer and the gate. A PR can't change
 * it for itself: the file is read from the base, never the PR head.
 *
 * Parsing fails closed. A missing file means the defaults; an unparseable file,
 * an unknown key, or an unknown value also means the defaults (UAT on), with the
 * problem reported so the check-run can say the file was ignored. See
 * docs/config.md.
 */
import { parse } from 'yaml';

const REPO_CONFIG_DIR = '.github';
const REPO_CONFIG_FILE = 'pr-policy.yml';
/** Where the config lives, relative to the repo root. */
export const REPO_CONFIG_PATH = `${REPO_CONFIG_DIR}/${REPO_CONFIG_FILE}`;
export const REPO_CONFIG_LOCATION = { dir: REPO_CONFIG_DIR, file: REPO_CONFIG_FILE } as const;

export const UAT_SETTINGS = ['on', 'off'] as const;
export type UatSetting = (typeof UAT_SETTINGS)[number];

export interface RepoConfig {
  /** `off` for a repo with nothing to user-test: no PR waits on UAT. */
  uat: UatSetting;
}

/** A loaded config, plus why any part of the file was ignored. */
export interface RepoConfigLoad {
  config: RepoConfig;
  /** Empty when the file was absent or valid; otherwise the defaults apply. */
  problems: string[];
}

export const DEFAULT_REPO_CONFIG: RepoConfig = { uat: 'on' };

const KNOWN_KEYS = new Set<string>(['uat']);

/** `on`/`off`, also as YAML booleans, since `uat: true` reads the same way. */
function uatSetting(value: unknown): UatSetting | undefined {
  if (value === true) return 'on';
  if (value === false) return 'off';
  return UAT_SETTINGS.find((setting) => setting === value);
}

/**
 * Parse the file's text (`undefined` when the base branch has no file). Any
 * problem discards the whole file, so a half-read config never loosens a gate.
 */
export function parseRepoConfig(text: string | undefined): RepoConfigLoad {
  if (text === undefined) return { config: DEFAULT_REPO_CONFIG, problems: [] };
  const failed = (problem: string): RepoConfigLoad => ({
    config: DEFAULT_REPO_CONFIG,
    problems: [`${REPO_CONFIG_PATH} was ignored: ${problem}`],
  });

  let doc: unknown;
  try {
    doc = parse(text);
  } catch (error) {
    return failed(
      `it is not valid YAML (${error instanceof Error ? error.message : 'parse error'})`,
    );
  }
  if (doc === null || doc === undefined) return { config: DEFAULT_REPO_CONFIG, problems: [] };
  if (typeof doc !== 'object' || Array.isArray(doc)) return failed('it is not a mapping');

  const record = doc as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) {
    return failed(`unknown key ${unknown.map((key) => `\`${key}\``).join(', ')}`);
  }
  if (!('uat' in record)) return { config: DEFAULT_REPO_CONFIG, problems: [] };
  const uat = uatSetting(record['uat']);
  if (uat === undefined) return failed('`uat` must be `on` or `off`');
  return { config: { uat }, problems: [] };
}
