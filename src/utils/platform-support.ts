import os from 'node:os';

export type HostOS = 'macos' | 'windows' | 'linux';
export type DisplayMode = boolean | 'virtual';

export class UnsupportedPlatformError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedPlatformError';
  }
}

export class UnsupportedDisplayModeError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDisplayModeError';
  }
}

export function mapHostOS(platform: NodeJS.Platform): HostOS {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

export function getHostOS(): HostOS {
  return mapHostOS(os.platform());
}

export function getHostArchitecture(): NodeJS.Architecture {
  return process.arch;
}

export function assertWindowsArchitectureSupported(hostOS: HostOS, architecture: NodeJS.Architecture): void {
  if (hostOS !== 'windows' || architecture === 'x64') return;

  throw new UnsupportedPlatformError(
    `Windows support currently requires x64. This runtime is ${architecture}; use a Windows x64 host/runtime.`,
  );
}

export function assertDisplayModeSupported(hostOS: HostOS, headless: DisplayMode): void {
  if (hostOS !== 'windows' || headless === true) return;

  throw new UnsupportedDisplayModeError(
    'Windows x64 support is headless-only. Virtual display mode uses Linux-only Xvfb/VNC, and native headed mode is not part of the verified Windows contract. Use headless=true.',
  );
}

export function assertBrowserPlatformSupported(
  hostOS: HostOS,
  architecture: NodeJS.Architecture,
  headless: DisplayMode,
): void {
  assertWindowsArchitectureSupported(hostOS, architecture);
  assertDisplayModeSupported(hostOS, headless);
}
