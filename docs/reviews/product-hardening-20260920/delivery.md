# Delivery/build survey and corrections

Parent reviewed the build/runtime helper, launcher packaging/signing, platform preparation,
publication/trust metadata, installers, DEV runner, version/readme links and CI selection/gates.
Acceptance/smoke scripts were read as opt-in supporting tools; no full verification pipeline ran.

Confirmed failure paths:

- `build-runtime-bundle.ts` deletes its supplied output recursively before compilation. A mistaken
  repository/source output can destroy inputs, and a compile/install failure discards the previous
  usable build. Added generated-path/ownership validation and same-filesystem staged replacement
  with rollback. AppImage tool staging uses the same helper instead of deleting unknown outputs.
- `prepare-runtime.cjs` rewrites licenses/notices after the runtime manifest was sealed. Removed
  duplicate writes; the bundler is the sole producer of the manifest-covered output.
- DEV readiness previously polled fixed port 4178 and could accept another project's old server
  or launch Electron after its newly spawned server exited. Vite now binds its own available
  loopback port and reports it over the exact child IPC channel; shutdown/exit abort launch and
  close owned resources. Vite runs under Node to avoid embedded Bun native-addon signing conflicts.
- The terminal installer accepted arbitrary version text before constructing recursive staging
  cleanup paths. Validate repository/version before path creation/traps.
- Platform launcher installers checked download hashes but did not invoke native publisher
  verification before replacement/execution. Added macOS codesign/Gatekeeper and Windows
  Authenticode validity gates. These native checks do not by themselves pin the fork's signing key;
  first-install script trust and the authenticated in-app updater remain distinct layers.

No current installed app, account session, release trust key, global route or provider credentials
were changed during this work. Windows preview remains separate from the signed installer flow.
