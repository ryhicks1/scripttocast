# The marketing site moved out of this repo

`site/` held the static marketing site for **webservicesforbusiness.com**. It now
lives in its own repository: **`ryhicks1/webservicesforbusiness`**.

The move used `git subtree split --prefix=site`, so the site's 36 commits came
across with their history intact — `git log` in the new repo shows the real
authorship and dates, not one squashed import.

## Why

Both sites shared this repository, but a Vercel project can only have one Root
Directory. Pointing the `scripttocast` project at `site/` to deploy the marketing
site took `scripttocast.com` offline; pointing it back broke the marketing site.
Two repositories, two projects, no collision.

## If you are looking for the site

Changes to the marketing site go in `ryhicks1/webservicesforbusiness` now.
Nothing in this repository serves webservicesforbusiness.com any more.
