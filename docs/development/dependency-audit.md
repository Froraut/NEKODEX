# Dependency audit exceptions

`bun run audit` and `bun run launcher:audit` run in `bun run verify`. An advisory is ignored only when no
fixed release exists and the vulnerable code does not run in a shipped NEKODEX path.

| Advisory | Package | Why it is ignored | Remove when |
| --- | --- | --- | --- |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | `sprintf-js` ≤ 1.1.3 (launcher) | It reaches the launcher only through Electron's download helper (`electron` / `electron-builder` > `@electron/get` > `global-agent` > `roarr`), which runs at install and packaging time with NEKODEX's own format strings. It is not part of the packaged app, and no fixed release exists. | `sprintf-js` publishes a fix, or `@electron/get` stops depending on `roarr`. |

The ignore lives in `launcher/package.json` (`"audit": "bun audit --ignore=GHSA-hp3w-g68c-fv3c"`).
