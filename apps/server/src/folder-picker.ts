import { execFile } from 'node:child_process';

/** The folder dialog cannot be shown here (no supported desktop on this machine). */
export class PickerUnsupported extends Error {
  constructor() {
    super('这台机器上暂不支持弹出选择文件夹的窗口，请手动编辑数据文件夹里的 workspaces.json');
    this.name = 'PickerUnsupported';
  }
}

type Execute = (
  file: string,
  args: string[],
  options: { timeout: number },
  callback: (error: (Error & { code?: number | string }) | null, stdout: string) => void,
) => void;

/** Waiting for a person: long enough to look for a folder, short enough not to hang forever. */
const DIALOG_TIMEOUT_MS = 5 * 60_000;

const SCRIPT = [
  'tell application "System Events"',
  'activate',
  'set chosen to choose folder with prompt "选择一个文件夹作为工作区"',
  'return POSIX path of chosen',
  'end tell',
];

/**
 * Ask the person at this machine to choose a folder, with the operating system's own dialog. The
 * server is local, so the dialog appears on the user's screen, and the path comes from their click:
 * the web page never says which folder (ADR 0014). Returns null when they cancel.
 *
 * Only macOS is supported for now; elsewhere it throws `PickerUnsupported`.
 */
export function pickFolder(
  platform: NodeJS.Platform = process.platform,
  execute: Execute = execFile as unknown as Execute,
): Promise<string | null> {
  if (platform !== 'darwin') return Promise.reject(new PickerUnsupported());
  return new Promise((resolve, reject) => {
    // Fixed arguments and no shell: nothing from a request reaches this command.
    execute(
      'osascript',
      SCRIPT.flatMap((line) => ['-e', line]),
      { timeout: DIALOG_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          // Cancelling the dialog is an ordinary answer, reported by osascript as an error.
          if (/-128|User canceled/i.test(error.message)) return resolve(null);
          return reject(error);
        }
        const chosen = stdout.trim().replace(/\/+$/, '');
        resolve(chosen === '' ? null : chosen);
      },
    );
  });
}
