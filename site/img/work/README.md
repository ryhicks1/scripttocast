# Work screenshots

`index.html` expects five JPEGs here:

```
sakura.jpg  teacherchang.jpg  willcool.jpg  acting.jpg  castingbrief.jpg
```

They are **not** committed yet — the sites were unreachable from the build
environment, so each card currently falls back to a styled plate.

Generate them with `node tools/capture-screenshots.mjs` from the `site/` folder,
or drop in your own. Landscape, roughly 16:10, showing the top of each page.
Anything close works: the cards crop to a fixed aspect ratio from the top.
