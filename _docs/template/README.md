# Private page template

A ready-to-copy private page: sign-in screen, synced storage, the dashboard's look (light/dark, hue setting) and
a small working example (a synced checklist) to replace. Background on `Sync`: [../private-pages.md](../private-pages.md).

Preview: open `/_docs/template/` on the site, or locally with `start_server.bat` (it must be served from the repo
root, since the page loads `/assets/sync.js`). The example stores its data under the key `template-items`.

## Making a new page

1. Copy this folder to `stuff/<page-name>/` (lowercase-with-dashes). Delete the copied `README.md`.
2. `index.html`: set the `<title>`, the `<h1>` and the subtitle. Replace the example cards inside
   `<div class="grid">`. Keep the stylesheet links (`base.css`, `app.css`, then `style.css`) and the two
   `<script>` lines in `<head>`.
3. `script.js`: change `KEY` to a new unique key, then replace the example list with the page's feature. Keep the
   `Sync.use` / `Sync.get` / `Sync.on` / `Sync.set` pattern. Update or remove the `merge` function to match the
   data's shape.
4. Optionally add a link to the new page from the dashboard header.

No database changes are needed; any new key is stored in the existing `kv` table.

## Styles: three layers

Pages share the main site's look, so a change to the hue or colours in one place applies everywhere.

1. **`/assets/base.css`**: shared with the main site. It holds the theme tokens (`--hue`, `--accent-hue`,
   colours, radii, borders, shadows), the dark theme (`class="dark"` on `<html>`), and `.card`, `.btn` and `.chip`.
   **The site's hue is set here**, not per page.
2. **`/assets/app.css`**: the layout and controls every tool page uses (listed below).
3. **The page's `style.css`**: only what's unique to that page. Always use the tokens (`var(--primary)`,
   `var(--line)`, `var(--radius)`), never fixed colours, so the page keeps following the site.

| From app.css | Use |
| --- | --- |
| `header`, `h1`, `.sub`, `.tools` | Page title row, subtitle, links/buttons on the right |
| `.grid`, `.card`, `.wide`, `.stack` | Two-column card layout (one column under 720px); `.wide` spans both |
| `.card h2` | Card title with the main site's accent bar |
| `button`, `button.pri`, `button[aria-pressed=true]` | Tinted button, main action, selected toggle |
| `.seg` | Segmented toggle (wrap `aria-pressed` buttons) |
| `input`, `select`, `textarea` | Tinted fields like the main site's search box |
| `.add`, `.btns` | Input + main button in one row; a wrapping row of buttons |
| `table`, `.scroll`, `td.num` | Tables with dividers, horizontal scroll wrapper, right-aligned numbers |
| `.note`, `.msg`, `.err`, `.pos`, `.neg` | Muted small text, status message, error, money in/out colours |
| `.chip.good` / `.bad` / `.warn` | Status chips |
| `dialog` | Modal styled like the cards |

| Token (base.css) | Meaning |
| --- | --- |
| `--page --card --text --title --sub` | Background, card, body text, headings, muted text |
| `--primary --link --tint --tint-hi` | Hue colour, links, tinted backgrounds (normal / hover) |
| `--accent --accent-tint` | Accent hue (highlights) |
| `--line --border --border-hi` | Divider colour, standard border, stronger border |
| `--radius-card --radius --radius-chip` | Corner radii: cards, controls, chips |
| `--shadow --shadow-hi` | Resting and raised shadows |
| `--pos --neg --warn` (+ `-tint`) | Status colours |

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
tokens, and replace the example feature completely rather than leaving template text behind. Put only page-specific
rules in the page's `style.css`. Anything two pages would share belongs in `/assets/app.css`, and colours or shapes
belong in `/assets/base.css` as tokens.
