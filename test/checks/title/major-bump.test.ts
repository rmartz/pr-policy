import { describe, expect, it } from 'vitest';
import { majorBumps } from '../../../src/checks/title/major-bump.js';

const npm = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });
const change = (path: string, baseText: string, headText: string) => ({ path, baseText, headText });

describe('majorBumps', () => {
  it('finds an npm dependency whose major version increased', () => {
    const bump = change(
      'package.json',
      npm({ 'left-pad': '^2.1.0' }),
      npm({ 'left-pad': '^3.0.0' }),
    );
    expect(majorBumps([bump])).toEqual(['left-pad 2.1.0 → 3.0.0']);
  });

  it('ignores a minor or patch bump', () => {
    const minor = change(
      'package.json',
      npm({ a: '^2.1.0', b: '~2.1.0' }),
      npm({ a: '^2.2.0', b: '~2.1.1' }),
    );
    expect(majorBumps([minor])).toEqual([]);
  });

  it('ignores a downgrade', () => {
    const down = change('package.json', npm({ a: '^3.0.0' }), npm({ a: '^2.1.0' }));
    expect(majorBumps([down])).toEqual([]);
  });

  it('ignores a package only added or only removed', () => {
    const added = change('package.json', npm({}), npm({ a: '^3.0.0' }));
    const removed = change('package.json', npm({ a: '^3.0.0' }), npm({}));
    expect(majorBumps([added, removed])).toEqual([]);
  });

  it('never reads the manifest’s own version as a dependency', () => {
    const release = change(
      'package.json',
      JSON.stringify({ version: '1.9.0' }),
      JSON.stringify({ version: '2.0.0' }),
    );
    expect(majorBumps([release])).toEqual([]);
  });

  it('skips a spec with no comparable version', () => {
    const tag = change('package.json', npm({ a: 'workspace:*' }), npm({ a: '^3.0.0' }));
    expect(majorBumps([tag])).toEqual([]);
  });

  it('finds a pip requirement whose major version increased', () => {
    const bump = change('requirements.txt', 'Django==3.2.1\n', 'django==4.0\n');
    expect(majorBumps([bump])).toEqual(['django 3.2.1 → 4.0.0']);
  });

  it('skips a manifest that does not parse', () => {
    const broken = change('package.json', '{', npm({ a: '^3.0.0' }));
    expect(majorBumps([broken])).toEqual([]);
  });
});
