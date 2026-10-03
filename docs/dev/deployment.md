# Deployment

The production site at https://bitbounce.app is served by the Cloudflare Worker
named `daw`. Its existing custom domains also include `daw.arrangedgodly.com`
and `bitbounce.arrangedgodly.com`. `wrangler.jsonc` identifies this production
Worker and serves the built `dist` directory as static assets.

Run `npm run deploy` to build and release to the production Worker. When calling
local binaries directly, build first, then run:

```powershell
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.jsonc --keep-vars
```

The separate Pages project `bitbounce` serves https://bitbounce-d2d.pages.dev.
Deploying there does not update bitbounce.app. `npm run deploy:pages` explicitly
targets that secondary site.

After a production release, verify the HTML and its entry JavaScript at
https://bitbounce.app, compare shipped JavaScript and audio asset hashes with the
local build, and inspect the production sound selectors. A successful Pages
deployment alone is not evidence that the custom domain has updated.

The Workers release configuration leaves existing domain mappings under
Cloudflare's control; no DNS or custom-domain migration is required.
