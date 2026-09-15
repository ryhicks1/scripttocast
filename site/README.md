# Web Services for Business — marketing site

Single-page static site for **webservicesforbusiness.com**. No build step, no
dependencies, no backend. Open `index.html` and it runs.

```
site/
├── index.html              the deploy build — markup, CSS and JS inline
├── index.standalone.html   same page with fonts inlined; opens with no server
├── robots.txt              blocks indexing while it's a preview deploy
├── fonts/                  Archivo + IBM Plex Mono (woff2, latin subset)
├── img/og.png              1200×630 social share card
├── img/work/               screenshots of the portfolio sites — SEE BELOW
└── tools/                  screenshot capture script
```

## Deploy

Vercel: set **Root Directory** to `site`, Framework Preset **Other**, and leave
build/install/output empty. Any static host works the same way.

## Indexing

The site is **live and indexable**: there is no robots meta tag, and `robots.txt`
allows crawling. Do not re-add a `noindex` tag or set `Disallow: /` — that would
pull a live site out of search results.

## Work screenshots — action needed

The Work cards expect five JPEGs in `img/work/`:

```
sakura.jpg  teacherchang.jpg  willcool.jpg  acting.jpg  castingbrief.jpg
```

**They are not committed.** The portfolio sites were unreachable from the build
environment, so each card currently falls back to a styled brand plate keyed to
that site's real colours. The page is not broken without them — it just gets
better with them.

To generate them, from inside `site/`:

```bash
npm i -D playwright
npx playwright install chromium
node tools/capture-screenshots.mjs
```

Then commit `img/work/` and redeploy. Each `<img>` carries `onerror="this.remove()"`,
so a missing or failed image reveals the plate underneath instead of a broken icon.

## Design

- **Type:** Archivo (400–800, headings and body) and IBM Plex Mono (labels,
  numerals). Self-hosted — no third-party request, no layout shift. ~65 KB total.
- **Colour:** near-black `#0C0D0F`, white text, and a single orange `#FF6B00`
  used only as micro-accent: the wordmark bar, hover states, focus rings, the
  demo tag. Deliberately sparing — do not expand it into headings or buttons.
- **Layout:** hairline grid, square corners, no shadows. Structure carries the
  design, not decoration.
- **Motion:** a 12px rise on scroll and nothing else. Off under
  `prefers-reduced-motion`.
- **Accessibility:** semantic landmarks, skip link, one `h1`, labelled fields,
  visible focus, `scroll-margin` so anchors clear the sticky header.

## Copy rules

- **Not personal.** No founder name, no first-person introduction, no "about me".
- **Not location-bound.** No city, region or country. It is a global services
  business.
- **No sole-trader framing.**
- **Terse.** Short sentences, concrete nouns. If a sentence only adds warmth,
  cut it.
- **No social profiles** and no surname anywhere.

## Contact form

Posts nowhere: validates, then opens the visitor's mail client. A honeypot field
is in place. To wire a backend, add `action` and `method` to `<form id="enquiry">`
— the submit handler steps aside when an `action` is present.
