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
  // 🔴 [CMH 고침 2026-08-30] 윈도우에서 «창 보이기»를 허용합니다. 원본과 다른 곳입니다.
  //
  // 원본 줄:  if (hostOS !== 'windows' || headless === true) return;
  //
  // 왜 고쳤나: 원본은 윈도우에서 headless=false 를 HTTP 400 으로 막습니다. 그런데 우리 네이버
  // 작업은 «창이 보여야» 합니다 — ①사장님이 같이 보셔야 하고(마켓은 되돌릴 수 없는 곳)
  // ②창을 숨기면 403 이 난 적이 있습니다(메모리 crawler-headless-blocked-headful-passes).
  //
  // 근거: 원본 개발자가 쓴 말은 "not part of the verified support contract"(우리가 시험한
  // 범위가 아니다)이지 "안 돌아간다"가 아닙니다. 밑에서 도는 camoufox-js + playwright-core 는
  // 우리 camoufox-mcp 가 윈도우에서 창을 띄우며 매일 쓰고 있는 조합입니다.
  //
  // 실측(2026-08-30): 이 줄을 고치고 POST /tabs {"headless":false} 를 부르니 파이어폭스 창이
  // 진짜 떴습니다 — 프로세스 18384, 창 제목 "Example Domain — Camoufox", MainWindowHandle≠0.
  //
  // ⚠ 'virtual'(Xvfb/VNC)은 리눅스 전용이라 윈도우에서 그대로 막습니다. false 만 통과시킵니다.
  if (hostOS !== 'windows' || headless === true || headless === false) return;

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
