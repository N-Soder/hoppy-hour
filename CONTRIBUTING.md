# Contributing

Thanks for your interest in HoppyHour! Bug reports, fixes and improvements are
welcome.

## Getting set up

Follow **Local development** in the [README](README.md). You'll need Node.js 22+
and npm.

## Before opening a pull request

Run the same checks CI runs:

```bash
npm run lint
npm run typecheck   # app + Pages Functions
npm test
npm run build
```

- Keep pull requests focused: one change per PR, with a clear description of
  what it does and why.
- Add or update tests in `src/test/` for logic changes (Functions code can be
  imported and tested directly; see `src/test/geocode-referer.test.ts`).
- Database changes need a new numbered file in `db/migrations/`, and
  `db/schema.sql` must be updated to match.
- **Never commit secrets** or real user data: no `.env`, no `.dev.vars`, no
  database exports. Use the `*.example` templates.

## Reporting security issues

Please don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
