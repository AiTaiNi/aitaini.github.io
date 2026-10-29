# Private page template

A ready-to-copy private page: sign-in screen, synced storage, the dashboard's look (light/dark, hue setting) and
a small working example (a synced checklist) to replace. Background on `Sync`: [../private-pages.md](../private-pages.md).

Preview: open `/_docs/template/` on the site, or locally with `start_server.bat` (it must be served from the repo
root, since the page loads `/assets/sync.js`). The example stores its data under the key `template-items`.

## Making a new page

1. Copy this folder to `stuff/<page-name>/` (lowercase-with-dashes). Delete the copied `README.md`.
2. `index.html`: set the `<title>`, the `<h1>`, the subtitle and the `--h` hue on `<html>`. Replace the example
   cards inside `<div class="grid">`. Keep the two `<script>` lines in `<head>`.
3. `script.js`: change `KEY` to a new unique key, then replace the example list with the page's feature. Keep the
   `Sync.use` / `Sync.get` / `Sync.on` / `Sync.set` pattern. Update or remove the `merge` function to match the
   data's shape.
4. Optionally add a link to the new page from the dashboard header.

No database changes are needed; any new key is stored in the existing `kv` table.

## Building blocks in style.css

| Class | Use |
| --- | --- |
| `.grid` | Two-column card layout, one column under 720px |
| `.card`, `.card.wide` | A panel; `.wide` spans both columns |
| `.add` | Input + accent button in one row |
| `.list` | Rows with a divider; `li.done` strikes the text |
| `.note`, `.sub` | Muted small text |
| `--bg --card --fg --mut --bd --ac --acs` | Colour tokens (follow the hue and dark mode) |

## Rules for pages built from this

- **Data stays private, code does not**: the page's HTML/JS is public, so never put secrets or personal data in it.
  Anything personal goes through `Sync.set`.
- **Render user text with `textContent`**, never `innerHTML`.
- **One key per feature**, a JSON value of up to a few hundred KB. Split large or ever-growing data across keys
  (`journal-2026`, `journal-2027`), or use a dedicated table via `Sync.db`.
- **Give items stable ids** (`'i' + Date.now()`) so merge functions can combine copies from two devices.
- **Re-render in `Sync.on`**: another device's change can arrive at any time.

## For Claude

When asked to make a new private page: copy this folder to `stuff/<name>/` as above, choose a new unique key
(check that existing pages don't already use it with a search for `Sync.use`), keep the head scripts and the style
tokens, and replace the example feature completely rather than leaving template text behind.
