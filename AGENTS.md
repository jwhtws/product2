# Project Working Rules

These rules apply to the entire repository.

- When the user requests a code modification or feature change, complete the requested work and run `npm.cmd run check` plus any other relevant tests, checks, or verification appropriate to the change.
- If verification succeeds, do not ask for separate confirmation. Commit only the intended changes and push the commit to the current `main` branch.
- If any relevant verification fails, do not commit or push. Report the failure and its cause to the user.
- Never commit `.wrangler/`, `node_modules/`, `.dev.vars`, environment files, credentials, secret keys, API tokens, or local runtime/build artifacts.
- Before every commit, inspect the files to be included and the staged diff, and confirm that only intended changes are staged.
