// The repo config parser is public API, shared with rmartz/pr-lifecycle.
import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_CONFIG, parseRepoConfig, REPO_CONFIG_PATH } from '../../src/index.js';

describe('parseRepoConfig', () => {
  it('names the file pr-policy and pr-lifecycle both read', () => {
    expect(REPO_CONFIG_PATH).toBe('.github/pr-policy.yml');
  });

  it('uses the defaults, UAT on, when the base branch has no file', () => {
    expect(parseRepoConfig(undefined)).toEqual({ config: { uat: 'on' }, problems: [] });
  });

  it.each([
    ['uat: off\n', 'off'],
    ['uat: on\n', 'on'],
    ['uat: false\n', 'off'],
    ['uat: true\n', 'on'],
    ['# nothing set yet\n', 'on'],
  ])('reads %j as uat %s', (text, uat) => {
    expect(parseRepoConfig(text)).toEqual({ config: { uat }, problems: [] });
  });

  it.each([
    ['unparseable YAML', 'uat: [off\n', 'not valid YAML'],
    ['a list', '- uat: off\n', 'not a mapping'],
    ['an unknown key', 'uat: off\nskip-title: true\n', 'unknown key `skip-title`'],
    ['an unknown value', 'uat: sometimes\n', '`uat` must be `on` or `off`'],
  ])('fails closed to UAT on for %s, and says why', (_case, text, problem) => {
    const { config, problems } = parseRepoConfig(text);
    expect(config).toEqual(DEFAULT_REPO_CONFIG);
    expect(problems).toEqual([expect.stringContaining(problem)]);
  });

  it('discards the whole file when any key is bad, so a half-read file never loosens', () => {
    expect(parseRepoConfig('uat: off\ntypo: 1\n').config.uat).toBe('on');
  });
});
