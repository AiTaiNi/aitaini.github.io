# Flashcards: the shared spaced-repetition engine (`/assets/srs.js`)

Any private page can have its own flashcard deck with the same scheduling the Indonesian pages use. The engine
(`window.SRS`) does the scheduling (FSRS), keeps cards and their schedule in your Supabase tables, and saves every
change through an offline queue. The page does the rest: what a card looks like, which cards are new today, and
anything subject-specific. First user: `personal/learning/indonesian/idn.js`.

## What the ratings mean

After you've seen the answer you rate how well you remembered it. The time on each button is **when you'll see the
card again** if you press it:

| Button | Press it when | What happens |
| --- | --- | --- |
| **Again** (1) | You didn't remember it, or got it wrong | The card counts as forgotten and comes back in a few minutes, in this session. Its interval starts over from short steps, and the card is treated as a bit harder from now on |
| **Hard** (2) | You remembered, but only with real effort or after hesitating | It comes back sooner than with Good, and the card is treated as slightly harder |
| **Good** (3) | You remembered it after a normal moment of thinking | The normal choice. It comes back after the interval at which you should still have about a 90% chance of remembering it |
| **Easy** (4) | You knew it instantly, no effort at all | It comes back later than with Good, and the card is treated as easier |

The times:

- **Minutes** (`1 min`, `6 min`, `10 min`): the card is still being learned and comes back later in the same session.
  A new card goes 1 min (Again), 6 min (Hard) or 10 min (Good), and after a Good in that step it moves on to days.
  **Easy** on a brand-new card skips the steps: you're telling it you already know the word.
- **Days, months, years** (`4 d`, `2 mo`, `1.2 y`): the card has been learned, and that's how long until it's due
  again. Each successful review stretches the gap, roughly 4 d → 2 weeks → 1–2 months → many months.
- The numbers come from the card's own history: how long ago you last saw it, how often you've forgotten it, and how
  hard it has proven. Two cards can show different times for the same button. Intervals of 3 days or more get a
  small random spread (±5%), so cards learned together don't all come back on the same day.
- Rating honestly matters more than rating kindly: pressing Good on something you'd forgotten makes the card return too
  late, and you'll forget it again. When in doubt between two buttons, pick the lower one.

**Retention** (a setting): the chance of remembering a card when it comes due. The default 90% is a good balance;
95% gives noticeably more reviews for a small gain, 85% fewer reviews and more forgetting.

## How it works

FSRS (Free Spaced Repetition Scheduler, v5 formulas with the default parameters) keeps three numbers per card and
direction: **stability** (how many days until the chance of remembering drops to 90%), **difficulty** (1–10) and the
**state** (new, learning, review, relearning). Each rating updates them, and the next due date is the day when the
chance of remembering falls to your target retention. The engine adds short learning steps in minutes for new and
forgotten cards.

A card can be reviewed in two **directions**, each with its own schedule: `recognise` (front → back, e.g. Indonesian
→ English) and `recall` (back → front, e.g. typing the Indonesian). A page decides which directions it uses.

## Giving a page its own deck

### 1. Tables (once, in Supabase)

SQL Editor → New query → paste → Run. Replace every `xx_` with a short prefix for the subject (e.g. `art_`,
`code_`); the card columns are only a starting point, add whatever the subject needs.

```sql
create table public.xx_cards (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  deck_id     text,                                 -- optional: id of a card in a prepared/public card list
  front       text,
  back        text,
  notes       text,
  tags        text[]      not null default '{}',
  suspended   boolean     not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, deck_id)
);

create table public.xx_schedule (
  card_id     uuid        not null references public.xx_cards on delete cascade,
  direction   text        not null check (direction in ('recognise', 'recall')),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  state       smallint    not null default 0,
  due         timestamptz not null default now(),
  stability   real        not null default 0,
  difficulty  real        not null default 0,
  reps        int         not null default 0,
  lapses      int         not null default 0,
  last_review timestamptz,
  primary key (card_id, direction)
);

create index xx_schedule_due on public.xx_schedule (user_id, due);

create table public.xx_reviews (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  client_id   uuid        not null,
  card_id     uuid        not null references public.xx_cards on delete cascade,
  direction   text        not null check (direction in ('recognise', 'recall')),
  rating      smallint    not null check (rating between 1 and 4),
  duration_ms int,
  reviewed_at timestamptz not null default now(),
  unique (user_id, client_id)
);

do $$
declare t text;
begin
  foreach t in array array['xx_cards', 'xx_schedule', 'xx_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Saves a review and the card's new schedule together; a review that was already saved is ignored (offline resends)
create or replace function public.xx_review(r jsonb, s jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  insert into public.xx_reviews (client_id, card_id, direction, rating, duration_ms, reviewed_at)
  values ((r->>'client_id')::uuid, (r->>'card_id')::uuid, r->>'direction', (r->>'rating')::smallint,
          (r->>'duration_ms')::int, coalesce((r->>'reviewed_at')::timestamptz, now()))
  on conflict (user_id, client_id) do nothing;

  if not found then return false; end if;

  insert into public.xx_schedule as cur (card_id, direction, state, due, stability, difficulty, reps, lapses, last_review)
  values ((r->>'card_id')::uuid, r->>'direction', (s->>'state')::smallint, (s->>'due')::timestamptz,
          (s->>'stability')::real, (s->>'difficulty')::real, (s->>'reps')::int, (s->>'lapses')::int,
          coalesce((r->>'reviewed_at')::timestamptz, now()))
  on conflict (card_id, direction) do update set
    state = excluded.state, due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
    reps = excluded.reps, lapses = excluded.lapses, last_review = excluded.last_review
  where cur.last_review is null or cur.last_review <= excluded.last_review;

  return true;
end $$;

revoke execute on function public.xx_review(jsonb, jsonb) from public, anon;
grant execute on function public.xx_review(jsonb, jsonb) to authenticated;
```

The Indonesian tables ([indonesian-database.md](indonesian-database.md)) are the same shape with more card columns.

### 2. The page

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"></script>
<script src="/assets/sync.js"></script>
<script src="/assets/srs.js"></script>
```

```js
const deck = SRS.deck({ cards: 'xx_cards', schedule: 'xx_schedule', review: 'xx_review', queue: 'xx-queue' });

Sync.db.auth.onAuthStateChange(async (_, session) => {
    if (!session || deck.loaded) return;

    deck.loaded = true;
    await deck.load();                                   /* cards + schedule, plus anything still queued offline */

    const { learn, review } = deck.due();                /* scheduled cards due today, soonest first */
    const fresh = [...deck.cards.values()].filter(c => !c.suspended && !deck.state(c, 'recognise')).slice(0, 10);
    const queue = [...learn, ...review, ...fresh.map(card => ({ card, dir: 'recognise' }))];

    /* show queue[0].card.front; on "Show answer" show .back and the four buttons, labelled with
       deck.preview(item.card, item.dir)[1..4]; on a button: */
    function rate(item, rating, msTaken) {
        const s = deck.answer(item.card, item.dir, rating, msTaken);

        if (s.state === 1 || s.state === 3) queue.push(Object.assign(item, { s }));   /* back in a few minutes */
    }
});

deck.addCard({ front: 'Hola', back: 'Hello', tags: ['greetings'] });   /* new card, saved (offline-safe) */
```

What the engine gives (`SRS.deck(options)`):

| | |
| --- | --- |
| `cards`, `sched` | Maps: card id → row; `"cardId|direction"` → FSRS state |
| `load()` | Reads both tables (all rows) and applies writes still waiting in the offline queue |
| `due(end?)` | `{ learn, review }`: scheduled, non-suspended cards due before `end` (default: end of today) |
| `state(card, dir)` | A card's schedule row in one direction, or null if it was never reviewed that way |
| `preview(card, dir)` | `{1: '1 min', 2: '6 min', 3: '10 min', 4: '16 d'}` for the buttons (`card` may be null for a new one) |
| `answer(card, dir, rating, ms)` | Schedules and saves; returns the new state (`isNew` = first review in that direction) |
| `addCard(row)`, `patchCard(card, patch)` | Add or change a card, saved through the queue |
| `enqueue(op)`, `flush()`, `pending()` | The offline queue, for extra write types declared in `ops` |

Options: `uniqueBy` (a unique card column such as `deck_id`, so two devices adding the same card end up with one),
`ops` + `coalesce` (extra write types through the same queue, e.g. study time), `retention` (a function returning the
target), `onFlush(pendingCount)`.

Also on `SRS`: `outcomes(cur, now, retention)` (the four results, pure), `label(ms)`, `all(db, table, cols, ...order)`
(every row, paged), `uuid()`, `dayKey()`, `startOfDay()`.

## What stays in each page

New-card order and daily limits, which directions a card uses, how cards look, extra data (examples, audio), study
time, Calendar tasks and hub lines. The Indonesian pages are the worked example of all of these.
