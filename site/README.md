# Web Services for Business — marketing site

Single-page static site for **webservicesforbusiness.com** (Ryan Hicks, Wollongong NSW).
No build step, no framework, no dependencies. Open `index.html` and it runs.

```
site/
├── index.html      the whole page — markup, CSS and JS inline
├── robots.txt      blocks indexing while it's a preview deploy
├── fonts/          Instrument Serif + Instrument Sans (self-hosted woff2, latin subset)
└── img/og.png      1200×630 social share card
```

## Deploy

**Vercel** — import the repo, then set **Root Directory** to `site`, Framework Preset
to **Other**, and leave the build and output settings empty. Static files are served as-is.

Anything else that serves a folder (Netlify drop, Cloudflare Pages, S3, cPanel) works the
same way: upload the contents of `site/`.

Nothing here talks to a server, so there are no environment variables or secrets.

## Going live — two changes

Both are marked `GO-LIVE` in the source:

1. **`index.html`** — delete `<meta name="robots" content="noindex, nofollow">` (near the top).
2. **`robots.txt`** — replace `Disallow: /` with `Allow: /`.

Until then the site is invisible to Google, which is what you want on a preview URL.

## Identity (locked 15 Sep 2026)

| Token | Value |
|---|---|
| `{{BUSINESS_NAME}}` | Web Services for Business |
| `{{DOMAIN}}` | webservicesforbusiness.com |
| `{{EMAIL}}` | support@webservicesforbusiness.com |

Already resolved throughout the file — the table is here so a future find-and-replace knows
what to look for. Other facts baked in: Ryan Hicks, ABN 43 762 178 040, 0450 914 150,
Wollongong NSW, linkedin.com/in/ryhicks1.

Notes:
- `admin@webservicesforbusiness.com` is an alias to the same inbox and is **not** used publicly.
- `onlineservicesforbusiness.com` is a redirect only (www + apex) and is **not** mentioned
  anywhere on the page — it isn't a second brand.
- Nav shortens to **WSFB** under 1080px; the full name stays in the hero, footer and OG card.
- No street address appears anywhere on the site, per the brief.

## The contact form

It posts nowhere. On submit it validates name + email, then opens the visitor's mail client
with a pre-filled message to `support@`. Nothing is stored and there is no third-party script.

To wire a real backend later (Formspree, Basin, Netlify Forms), add `action` and `method` to
the `<form id="enquiry">` tag — the submit handler checks for `action` and steps aside when
one is present, so the mailto path turns itself off:

```html
<form id="enquiry" action="https://formspree.io/f/XXXXXXX" method="POST">
```

A honeypot field (`name="website"`, visually hidden) is already in place for spam.

## Design notes

- **Type:** Instrument Serif for display, Instrument Sans for everything else. Self-hosted, so
  there is no request to Google and no layout shift; the two faces used above the fold are
  preloaded. Total font weight ~105 KB.
- **Colour:** bone paper `#F4F1EA`, ink `#141310`, deep green `#11261F` for the inverted
  sections, burnt clay `#C25E2A` as the single accent — with a lighter `#D07B3C` reserved for
  the dark ground so every text pair clears WCAG AA (verified, 0 failures).
- **Work cards:** the five portfolio links get designed brand plates rather than screenshots —
  each with its own palette, typeface and texture. Demo builds are labelled "DEMO BUILD" on
  the plate and "Demo" in the caption, so nothing is passed off as a client site.
- **Motion:** a staggered 14px rise on scroll, a drawn underline on links, and nothing else.
  All of it switches off under `prefers-reduced-motion`.
- **Mobile:** sticky Call / Send-an-enquiry dock appears past the hero, and a full-screen menu
  (Escape closes it, focus stays inside while open).
- **Accessibility:** semantic landmarks, skip link, one `h1`, labelled form fields, visible
  focus rings, `scroll-margin` so anchor jumps clear the sticky header.
- **SEO/social:** meta title and description, canonical, Open Graph and Twitter cards,
  and `ProfessionalService` JSON-LD with the ABN-backed business details.

## Swapping the brand plates for real screenshots

The plates live in section 10 of the stylesheet (`.pl-sakura`, `.pl-anytime`, `.pl-will`,
`.pl-acting`, `.pl-brief`). To use a real screenshot instead, drop the image in `img/` and
replace that card's `<div class="plate …">` with:

```html
<div class="plate"><img src="img/sakura.webp" alt="Sakura Wollongong homepage"></div>
```

Add `.plate img{width:100%;height:100%;object-fit:cover;object-position:top}` and keep the
`aspect-ratio` as-is so the grid doesn't move.
