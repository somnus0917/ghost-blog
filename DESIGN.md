# Theme customization

The visual direction is a quiet, warm editorial notebook inspired by Shiro/Yohaku:
generous whitespace, restrained borders, dusty red accents, and handwritten Chinese
typography.

## Where to edit

- `theme/somnus-yohaku/assets/css/screen.css`: colors, type, spacing, responsive layout.
- `theme/somnus-yohaku/home.hbs`: homepage composition and copy.
- `theme/somnus-yohaku/post.hbs`: article layout, table of contents, and comments.
- `theme/somnus-yohaku/partials/`: navigation, footer, and repeated components.
- `theme/somnus-yohaku/assets/js/main.js`: theme switching and small interactions.

The main design tokens are at the top of `screen.css`. Change `--paper`, `--ink`,
`--accent`, `--page`, and `--article` first; this keeps the whole theme coherent.

## Typography

The site self-hosts the official LXGW WenKai Regular web font at
`shared/fonts/LXGWWenKai-Regular.woff2`. `make dev` installs it into Ghost's persistent
`content/images/fonts/` directory, and production provisioning does the same. Keeping
the 7.5 MiB font outside the repeatedly uploaded theme zip prevents cross-border CI
timeouts. `font-display: swap` keeps text visible while it downloads, and the original
SIL Open Font License is included beside the font.

The quickest way to change the site's font size is to edit these variables near the
top of `assets/css/screen.css`:

```css
--type-body: 19px;            /* global body and interface baseline */
--type-ui: 15px;              /* navigation, summaries, secondary text */
--type-small: 13px;           /* dates, labels, metadata */
--type-list-title: 20px;      /* homepage and archive article titles */
--type-article: 20px;         /* desktop article body */
--type-article-mobile: 19px;  /* mobile article body */
```

Adjust those six values in that order to scale the interface without hunting through
individual selectors.
Run `make dev` after saving, then refresh the local page.

## Local loop

From this repository directory:

```bash
cp .env.example .env
make dev
```

Start Docker Desktop before running the commands. Open `http://127.0.0.1:2369/ghost/`,
complete the local Ghost setup once, then activate `somnus-yohaku` under the theme
settings. Port `2369` is intentionally used so an SSH tunnel on the production port
`2368` can stay open. Theme edits are copied into the local Ghost content directory
and Ghost is recreated safely each time `make dev` runs. Before pushing:

```bash
make check
```

## Production flow

Pull requests run the theme checks but never deploy. A push to `main` that changes
the theme or build/deploy scripts creates a checked theme archive and uploads it with
Ghost's official `TryGhost/action-deploy-theme` action. The workflow only receives a
Ghost custom-integration key; it does not receive Tencent Cloud shell access.
