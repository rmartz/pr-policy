import { describe, expect, it } from 'vitest';
import { parseClaims, titlePackage } from '../../../src/checks/dependabot/claims.js';

// Shapes copied from real fleet Dependabot PRs (release notes trimmed).
const SINGLE =
  'Bumps [@sentry/nextjs](https://github.com/getsentry/sentry-javascript) from 10.75.1 to 11.0.0.\n<details>\n<summary>Release notes</summary>\n<li>build(deps): bump jwks-rsa from 4.0.1 to 4.1.0</li>\n</details>';

const GROUP = [
  'Bumps the production-dependencies group with 2 updates: [firebase-admin](https://github.com/firebase/firebase-admin-node) and [next](https://github.com/vercel/next.js).',
  '',
  'Updates `firebase-admin` from 14.4.0 to 14.5.0',
  '<details><summary>Commits</summary></details>',
  '',
  'Updates `next` from 16.0.1 to 16.0.2',
].join('\n');

const ACTIONS = [
  'Bumps the github-actions group with 1 update in the / directory: [rmartz/merge-safety/.github/workflows/merge-safety.yml](https://github.com/rmartz/merge-safety).',
  '',
  'Updates `rmartz/merge-safety/.github/workflows/merge-safety.yml` from 0.2.0 to 0.6.0',
].join('\n');

describe('parseClaims', () => {
  it('reads a single update from its `Bumps` sentence, without the trailing period', () => {
    expect(parseClaims(SINGLE)).toEqual([{ name: '@sentry/nextjs', to: '11.0.0' }]);
  });

  it('ignores bump lines quoted from upstream release notes', () => {
    expect(parseClaims(SINGLE).map((claim) => claim.name)).not.toContain('jwks-rsa');
  });

  it('reads each entry of a grouped update, not the group header', () => {
    expect(parseClaims(GROUP)).toEqual([
      { name: 'firebase-admin', to: '14.5.0' },
      { name: 'next', to: '16.0.2' },
    ]);
  });

  it("reads a large group's summary table, which survives Dependabot truncating the body", () => {
    const body = [
      'Bumps the dev-dependencies group with 19 updates in the / directory:',
      '',
      '| Package | From | To |',
      '| --- | --- | --- |',
      '| [@storybook/nextjs-vite](https://github.com/storybookjs/storybook) | `10.4.6` | `10.6.0` |',
      '| [tsx](https://github.com/privatenumber/tsx) | `4.23.0` | `4.23.15` |',
      '',
      'Updates `@storybook/nextjs-vite` from 10.4.6 to 10.6.0',
      '_Description has been truncated_',
    ].join('\n');
    expect(parseClaims(body)).toEqual([
      { name: '@storybook/nextjs-vite', to: '10.6.0' },
      { name: 'tsx', to: '4.23.15' },
    ]);
  });

  it("names a truncated group's remaining packages from its header, with no target", () => {
    const body = [
      'Bumps the react group with 2 updates: [react](https://github.com/react/react) and [@types/react-dom](https://github.com/DefinitelyTyped/DefinitelyTyped).',
      'Updates `react` from 19.2.8 to 19.3.0',
      '_Description has been truncated_',
    ].join('\n');
    expect(parseClaims(body)).toEqual([
      { name: 'react', to: '19.3.0' },
      { name: '@types/react-dom' },
    ]);
  });

  it('reads an action or reusable-workflow update', () => {
    expect(parseClaims(ACTIONS)).toEqual([
      { name: 'rmartz/merge-safety/.github/workflows/merge-safety.yml', to: '0.6.0' },
    ]);
  });

  it('reads a range change and a removal as claims with no target version', () => {
    const body =
      'Updates the requirements on [ruff](https://github.com/astral-sh/ruff) to permit the latest version.\nRemoves `left-pad`';
    expect(parseClaims(body)).toEqual([{ name: 'ruff' }, { name: 'left-pad' }]);
  });

  it('drops the zero-width space Dependabot puts after `@` in a scope', () => {
    expect(parseClaims('Updates `@​types/node` from 1.0.0 to 1.1.0')).toEqual([
      { name: '@types/node', to: '1.1.0' },
    ]);
  });

  it('claims nothing from a description a person rewrote', () => {
    expect(parseClaims('Bumped a few things, see the lockfile.')).toEqual([]);
  });
});

describe('titlePackage', () => {
  it('names the package in a single-update title, retitled or not', () => {
    expect(titlePackage('ci(deps): bump prettier from 3.9.8 to 3.9.9 in the prettier group')).toBe(
      'prettier',
    );
    expect(titlePackage('chore(deps): Bump rmartz/bot-automerge-action from 1.1.1 to 2.0.0')).toBe(
      'rmartz/bot-automerge-action',
    );
  });

  it('names nothing for a group title', () => {
    expect(titlePackage('chore(deps): bump the npm group with 3 updates')).toBeUndefined();
  });
});
