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
`assets/fonts/LXGWWenKai-Regular.woff2`. `font-display: swap` keeps text visible while
the font downloads. The original SIL Open Font License is included beside the font.

## Local loop

From this repository directory:

```bash
cp .env.example .env
make dev
```

Open `http://127.0.0.1:2368`, complete the local Ghost setup once, and activate
`somnus-yohaku`. Theme edits are copied into the local Ghost content directory each
time `make dev` runs. Before pushing:

```bash
make check
```

## Production flow

Pull requests run the theme checks but never deploy. A push to `main` that changes
the theme or build/deploy scripts creates a checked theme archive and uploads it with
Ghost's official `TryGhost/action-deploy-theme` action. The workflow only receives a
Ghost custom-integration key; it does not receive Tencent Cloud shell access.
