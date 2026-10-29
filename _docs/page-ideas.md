# Private page ideas

Candidates for new signed-in pages. Build them from [template/](template/) (see its README). Tick an item when it's
built, and move it to **Done** with a link.

Remember: page code is public; only data saved through `Sync` or Supabase tables is private.

## Built on what's already tracked

- [ ] **Watch log**: anime/manga/shows in progress, with episode counters (like the daily-task counters),
      ratings and a dropped list. Could pull from the MAL stats file.
- [ ] **Habit insights**: streaks, best/worst weekdays and completion rate per task, from the daily-task history.
      Read-only, so it adds no new data. *Suggested first: quick win.*
- [ ] **Spending insights**: monthly totals, top merchants and categories, and USD vs PEN from the saved statements
      (`transactions` table). Card payments from the debit account need excluding so they aren't counted twice.
- [ ] **Subscriptions**: recurring charges spotted in the statements (Microsoft 365, Patreon, YouTube…) with
      renewal dates and monthly cost.

## Personal records

- [ ] **Journal**: one entry per day, linked from the Calendar page. Split storage per year
      (`journal-2026`, `journal-2027`) or use its own table.
- [ ] **Mood / sleep log**: one tap a day, shown as a heatmap with the calendar's colour scale.
- [ ] **Health**: weight, workouts, medication/supplement checklist.
- [ ] **Reading / wishlist**: books, games and things to buy, with status, priority and price.

## Utility

- [ ] **Bookmarks**: private link board with tags, usable as a start page.
- [ ] **Recipes / meal plan**: weekly plan that builds a shopping list.
- [ ] **Private file drop**: scans, receipts and documents in a private Supabase Storage bucket, reachable only
      when signed in.

## Bigger

- [ ] **Year in review**: automatic summary combining tasks, watch log, spending and journal.
- [ ] **Shared pages**: a second account (e.g. a partner) with a shared list. The database rules currently allow
      per-user rows only, so this needs a policy change.

## Done

- [x] **Page hub**: index of all private pages with live status (today's progress, next countdown, latest
      statement). [personal/](../personal/)
- [x] **Today**: today's checklist, upcoming countdowns, and a general synced notepad. The notepad also covers the
      "quick notes / clipboard" idea (paste on one device, copy on another). [personal/today/](../personal/today/)
- [x] **Calendar**: month view coloured by task completion, daily tasks (with counters), one-time and recurring
      events, countdowns (⏱ on an event, shown when at most 2 weeks away), list of all events, Today button.
      [personal/calendar/](../personal/calendar/)
- [x] **Dashboard**: calendar and today's checklist (managed on the Calendar page), exchange rate, MAL, YouTube.
      [personal/dashboard/](../personal/dashboard/)
- [x] **Bank statements**: BCP credit/debit PDFs parsed locally (`parse_statements.py`), stored in Supabase, with
      a filterable viewer, categories and notes. Covers the import side of the "money in two currencies" idea.
      [personal/statements/](../personal/statements/), [statements.md](statements.md)

### Groundwork

- [x] Sign-in and cross-device sync for private pages (Supabase). [sync-setup.md](sync-setup.md)
- [x] Page template and guide. [template/](template/)
- [x] Shared look with the main site: theme, hue and shapes in `/assets/base.css`, tool-page layout in
      `/assets/app.css`, task/calendar feature in `/assets/tasks.js` + `tasks.css` (one shared data set).
