import { describe, expect, it } from 'vitest';
import { ciRetitle } from '../../../src/checks/title/ci-retitle.js';
import { decideTitle } from '../../../src/checks/title/index.js';
import type { PullRequestFacts } from '../../../src/policy.js';

const DEPENDABOT = { login: 'dependabot[bot]', type: 'Bot' };

function manifest(devDependencies: Record<string, string>): string {
  return JSON.stringify({ name: 'consumer', devDependencies });
}

function makeFacts(options: {
  title: string;
  from: Record<string, string>;
  to: Record<string, string>;
  author?: PullRequestFacts['author'];
}): PullRequestFacts {
  return {
    title: options.title,
    body: '',
    author: options.author ?? DEPENDABOT,
    labels: [],
    changedFiles: ['package.json'],
    workflowChanges: [],
    manifestChanges: [
      { path: 'package.json', baseText: manifest(options.from), headText: manifest(options.to) },
    ],
    signOffs: [],
  };
}

const blocks = (pr: PullRequestFacts) =>
  decideTitle(pr).findings.filter((finding) => finding.effect === 'block');

describe('ciRetitle: a Dependabot PR bumping a CI-sensitive tool', () => {
  it.each(['prettier', 'eslint'])('retitles a %s bump to ci', (tool) => {
    const pr = makeFacts({
      title: `chore(deps-dev): bump ${tool} from 3.1.0 to 3.2.0`,
      from: { [tool]: '3.1.0' },
      to: { [tool]: '3.2.0' },
    });
    expect(ciRetitle(pr)).toBe(`ci(deps-dev): bump ${tool} from 3.1.0 to 3.2.0`);
  });

  it('gives a title the title check passes, where the original was blocked', () => {
    const pr = makeFacts({
      title: 'chore(deps-dev): bump prettier from 3.1.0 to 3.2.0',
      from: { prettier: '3.1.0' },
      to: { prettier: '3.2.0' },
    });
    const title = ciRetitle(pr) ?? '';
    expect([blocks(pr).length > 0, blocks({ ...pr, title })]).toEqual([true, []]);
  });

  it('keeps a title without a scope', () => {
    const pr = makeFacts({
      title: 'build: bump prettier from 3.1.0 to 3.2.0',
      from: { prettier: '3.1.0' },
      to: { prettier: '3.2.0' },
    });
    expect(ciRetitle(pr)).toBe('ci: bump prettier from 3.1.0 to 3.2.0');
  });

  it('leaves a title already typed ci alone', () => {
    const pr = makeFacts({
      title: 'ci(deps-dev): bump prettier from 3.1.0 to 3.2.0',
      from: { prettier: '3.1.0' },
      to: { prettier: '3.2.0' },
    });
    expect(ciRetitle(pr)).toBeUndefined();
  });

  it.each(['fix', 'feat', 'perf', 'revert'])('leaves a release-typed %s title alone', (type) => {
    const pr = makeFacts({
      title: `${type}(deps): bump the production group with 2 updates`,
      from: { prettier: '3.1.0', lodash: '4.17.20' },
      to: { prettier: '3.2.0', lodash: '4.17.21' },
    });
    expect(ciRetitle(pr)).toBeUndefined();
  });
});

describe('ciRetitle: everything else is left alone', () => {
  it('a Dependabot PR with no sensitive bump', () => {
    const pr = makeFacts({
      title: 'chore(deps-dev): bump vitest from 3.1.0 to 3.2.0',
      from: { vitest: '3.1.0' },
      to: { vitest: '3.2.0' },
    });
    expect(ciRetitle(pr)).toBeUndefined();
  });

  it('a PR not opened by Dependabot', () => {
    const pr = makeFacts({
      title: 'chore(deps-dev): bump prettier from 3.1.0 to 3.2.0',
      author: { login: 'octocat', type: 'User' },
      from: { prettier: '3.1.0' },
      to: { prettier: '3.2.0' },
    });
    expect(ciRetitle(pr)).toBeUndefined();
  });

  it('a PR whose author is unknown', () => {
    const { author: _author, ...pr } = makeFacts({
      title: 'chore(deps-dev): bump prettier from 3.1.0 to 3.2.0',
      from: { prettier: '3.1.0' },
      to: { prettier: '3.2.0' },
    });
    expect(ciRetitle(pr)).toBeUndefined();
  });

  it('a title that is not a Conventional Commit', () => {
    const pr = makeFacts({
      title: 'Bump prettier from 3.1.0 to 3.2.0',
      from: { prettier: '3.1.0' },
      to: { prettier: '3.2.0' },
    });
    expect(ciRetitle(pr)).toBeUndefined();
  });
});
