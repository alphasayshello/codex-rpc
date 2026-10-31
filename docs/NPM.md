# npm publishing

Registry package: `@alphasayshello/codex-rpc`. The command remains `codex-rpc`.
The unscoped `codex-rpc` package belongs to another project.

The maintainer account is `alphasayshello`. Direct publishing requires npm login and account 2FA. GitHub release downloads remain available independently.

## First publication

1. Create and verify the npm account matching the package scope. Account passwords, passkeys, email verification and terms acceptance belong to the maintainer; do not put credentials or verification codes in Git or chat.
2. Run `npm login --auth-type=web`, finish the browser sign-in, and confirm the account with `npm whoami`.
3. Review `npm pack --dry-run --json`. The explicit file allowlist includes the CLI, runtime, bundled art, dashboard and documentation. Local settings, logs, transcripts, credentials, build output and nested dependencies must not be present.
4. Run `npm run check`, `npm test`, and `npm run release:prepare`. Install the generated archive in a disposable prefix and verify `codex-rpc version` and isolated `setup --no-service --no-start`.
5. Commit and push the reviewed source. Publish with `npm publish --access public`. The `prepublishOnly` hook runs syntax and unit checks again. Complete npm's browser/MFA prompt yourself if requested.
6. Verify `npm view @alphasayshello/codex-rpc version dist.integrity`, install the registry package in a disposable prefix, and update the README to use the verified registry command.

After publication, users can run:

```sh
npx @alphasayshello/codex-rpc@latest setup
```

Or install persistently:

```sh
npm install -g @alphasayshello/codex-rpc
codex-rpc setup
codex-rpc serve
```

Setup runs only when requested. Installing the package does not automatically modify Codex configuration, start a service or collect data. Configuration, the installed runtime, hook integration and analytics continue to use `~/.codex-rpc/`.

## Upgrade from an older GitHub archive

Older archives registered the unscoped local package name `codex-rpc`. If the scoped installation reports `EEXIST` for that command, first confirm the installed package points to this repository with `npm list -g --depth=0` and its `package.json` repository field. Then remove the old npm package and install the scoped one:

```sh
npm uninstall -g codex-rpc
npm install -g @alphasayshello/codex-rpc
codex-rpc setup
```

`npm uninstall` removes the old global package and command link. The stable runtime, analytics and preferences under `~/.codex-rpc/` are retained. This is different from running the CLI's `uninstall` integration-removal command. Do not force-overwrite a command owned by an unrelated package.

## Later releases

Keep all package versions aligned, retain existing published tags and npm versions, and bump before publishing a new registry version. `publishConfig` selects the public npm registry and public access explicitly. GitHub archive names remain `codex-rpc-VERSION.tgz` and `codex-rpc.tgz`, independent of npm's scoped pack filename.

GitHub login and npm login are separate. A GitHub personal access token is not an npm publishing credential. For future CI publishing, configure an npm trusted publisher for this repository and an explicit workflow; this requires a separate, reviewed package-settings change. No npm token is needed in the repository, and this setup does not add automatic publishing or bypass MFA.

Official references: [public scoped packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) · [account creation](https://docs.npmjs.com/creating-a-new-npm-user-account/) · [trusted publishers](https://docs.npmjs.com/trusted-publishers/).
