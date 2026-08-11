# Third-Party Notices

The portable Windows distribution redistributes the following runtime components in addition to camofox-browser itself.

## Node.js v22.23.2

- Project: https://nodejs.org/
- Source: https://github.com/nodejs/node/tree/v22.23.2
- License: MIT, with additional third-party notices included by the upstream Node.js distribution.
- The upstream `LICENSE` file is retained in the portable bundle under `node/LICENSE`.

## Camoufox v152.0.4-beta.28

- Project: https://github.com/daijro/camoufox
- Source: https://github.com/daijro/camoufox/tree/v152.0.4-beta.28
- License: Mozilla Public License 2.0 (MPL-2.0).
- The portable bundle redistributes the unmodified Windows x64 release archive contents.

## camoufox-js 0.8.5

- Project: https://github.com/apify/camoufox-js
- Source revision published by npm: https://github.com/apify/camoufox-js/tree/afce2afa1300f1a938c0eb04aae92ff73fcd2c5b
- License: Mozilla Public License 2.0 (MPL-2.0).
- The package license is retained under `app/node_modules/camoufox-js/`.

## impit 0.7.6 / impit-win32-x64-msvc 0.7.6

- Project: https://github.com/apify/impit
- Source revision published by npm: https://github.com/apify/impit/tree/be0331c1ea34349a6d97c5f269a4af1d21d783e7
- License: Apache License 2.0.
- The Windows x64 native package is required by `impit`, a runtime dependency of `camoufox-js`.
- A copy of the Apache License 2.0 is retained in the portable bundle at `licenses/Apache-2.0.txt`.

The Mozilla Public License 2.0 text used by Camoufox/camoufox-js is retained at `licenses/MPL-2.0.txt`. The redistributed Camoufox executable is the unmodified upstream `v152.0.4-beta.28` Windows x64 release; its corresponding source code is available from the exact upstream source tag linked above.

## Other npm runtime dependencies

Production npm dependencies are installed from the repository lockfile with their package metadata and license files preserved under `app/node_modules/`. Refer to each package's included `package.json` and license file for its applicable terms.

camoufox-browser itself is licensed under the MIT License; see `app/LICENSE` in the portable bundle.
