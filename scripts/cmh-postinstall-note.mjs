/**
 * 🔴 [CMH 추가 2026-08-30] 원본에 없던 파일입니다.
 *
 * ## 왜 만들었나 — 「판이 저절로 바뀌지 않게」 (사장님 지시 2026-08-30)
 *
 * 원본 `package.json` 의 `postinstall` 은 이랬습니다:
 *
 *     "postinstall": "npx camoufox-js fetch || true"
 *
 * 이 줄은 **설치할 때마다 camoufox 브라우저 알맹이를 «최신»으로 바꿉니다.**
 * `camoufox-js fetch` 에는 판을 고정하는 옵션이 **없습니다**(`--help` 를 돌려 보면 `-h` 뿐입니다).
 *
 * 그리고 그 알맹이는 **이 폴더 안이 아니라 온 컴퓨터에 하나뿐인 자리**에 깔립니다:
 *
 *     C:\Users\<사용자>\AppData\Local\camoufox\camoufox\Cache\camoufox.exe
 *
 * 즉 **우리 `camoufox-mcp`(네이버 담당)와 같은 알맹이를 씁니다.**
 * 2026-08-30 에 이 저장소를 처음 설치했더니 실제로 이렇게 찍혔습니다:
 *
 *     Updating Camoufox binaries from v152.0.4-beta.28 => v152.0.4-beta.29
 *
 * 네이버 자동화가 쓰던 브라우저가 **아무도 모르게 바뀐 것**입니다. 그래서 자동 내려받기를 끕니다.
 *
 * ## 그럼 알맹이가 없는 새 컴퓨터에서는?
 *
 * 손으로 한 번 부릅니다 — **일부러 부르는 것**이라 언제 바뀌었는지 알 수 있습니다:
 *
 *     npm run camoufox:fetch
 *
 * ⚠ 그 명령은 **늘 최신을 받습니다.** 지금 우리가 쓰는 판은 **v152.0.4-beta.29** 입니다
 *   (2026-08-30 실측). 받은 뒤 판이 달라졌으면 네이버 화면이 그대로 도는지 확인하십시오.
 */

console.log('');
console.log('[CMH] camoufox 알맹이 «자동» 내려받기를 껐습니다 (판이 저절로 바뀌지 않게).');
console.log('[CMH] 알맹이가 없으면 손으로:  npm run camoufox:fetch');
console.log('[CMH] 까닭은 scripts/cmh-postinstall-note.mjs 맨 위에 적어 두었습니다.');
console.log('');
