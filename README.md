# Next.js static export: a small reproduction and container recipe

AI-assisted code, reviewed and tested with synthetic pages only. This reproduces the reported `next start` / `output: 'export'` mismatch, then tests a static server for the generated `out` directory.

## Historical fixture versus an application deployment

The fixture pins Next **14.2.30** solely to reproduce the reported version. npm identifies that version as vulnerable. Do not downgrade an application to match this fixture or treat it as a production dependency recommendation; use a supported, patched Next version in the real application. The runtime image installs only `serve`, not Next or React.

Keep the application's `output: 'export'`. Build it with `next build`, then serve the complete `out` tree. A static export does not use `next start` or require a different Railway project type. Server-only Next features remain incompatible with a static export.

## Reproduce locally

```sh
npm ci --no-audit --no-fund
npm run proof
```

The script builds the small fixture, confirms the original `next start` error, starts pinned `serve@14.2.6`, performs real HTTP checks, then stops the server. `proof-result.json` records **13 passing checks** from the local Windows/Node25 run, including `/about`, exact generated CSS/JS, custom404, missing assets, disabled directory listings, runtime `PORT` and a non-loopback IPv4 connection. Host interface addresses are omitted.

`proof-result.json` is **pre-Docker evidence**. The GitHub workflow separately repeats the fixture on Node22/Linux, then builds and runs the actual Docker image. A successful Docker job is separate evidence; the existence of the workflow alone is not a successful run. No Railway deployment or requester application has been tested.

## Container

```sh
docker build --tag static-export-proof .
docker run --rm -e PORT=4317 -p 127.0.0.1:4317:4317 static-export-proof
```

The two-stage Dockerfile copies the complete build output into a nonroot static runtime. It uses `runtime/package.json` and its lockfile to install only the pinned server. When adapting it to an existing app, retain that app's package files and build steps in the build stage; the fixture pages and single-worker setting are not required.

The exec-form entrypoint lets `serve` read the runtime `PORT` environment variable directly; no literal `$PORT` shell argument is used. Remove a Railway Custom Start Command that still invokes `next start` so the image's CMD can run. Keep the custom domain's target port aligned with the server port.

`serve.json` enables clean URLs and disables directory browsing. The CLI resolves the config path relative to `out`, so the argument is `--config ../serve.json`. Do not add `-s`: its SPA fallback can turn unknown routes into the home page with status200.

## References

- [Next14 static exports](https://nextjs.org/docs/14/app/building-your-application/deploying/static-exports)
- [Railway start-command rules](https://docs.railway.com/deployments/start-command)
- [serve-handler configuration](https://github.com/vercel/serve-handler#options)

Original code is MIT licensed. Dependencies retain their respective licenses.
