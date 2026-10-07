// Clones the original Android port into reference/ at a pinned commit.
// The clone is read-only reference material for porting and is not part of this repository.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const REPO = 'https://github.com/evgenyzinoviev/gravitydefied.git';
const COMMIT = 'ee26c95fddff87826cfba7bfcdda6bac156c8741';
const DIR = 'reference';

const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });

if (!existsSync(DIR)) git('clone', '--no-checkout', REPO, DIR);
git('-C', DIR, 'fetch', 'origin', COMMIT);
git('-C', DIR, '-c', 'advice.detachedHead=false', 'checkout', COMMIT);
