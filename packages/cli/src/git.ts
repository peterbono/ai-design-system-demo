import { execFile } from 'node:child_process';

/** `owner/name` of the origin remote when it is on GitHub. */
export function originRepo(root: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd: root }, (err, out) => {
      resolve(err ? undefined : /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(out.trim())?.[1]);
    });
  });
}
