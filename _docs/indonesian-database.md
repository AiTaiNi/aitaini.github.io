# Indonesian pages: database setup

The tables the Indonesian pages ([indonesian.md](indonesian.md)) keep your progress in. Assumes
[sync-setup.md](sync-setup.md) is done. Run this once, before the first Indonesian page is built; nothing reads
these tables yet.

## What goes where

| Where | What | Why |
| --- | --- | --- |
| `personal/learning/indonesian/data/` (public files, built by Python) | Dictionary, deck order, example sentences, slang list, lessons, drills, plan | Same for everyone, no personal data, cached offline |
| Supabase tables (below) | Your cards, scheduling state, every review, study and immersion time, sources, mined sentences, notes, drill results | Grows daily and needs querying (due cards, weekly hours) |
| Synced keys (`kv`) | `idn-settings` (daily limits, voice, target retention), `idn-summary` (the hub tile's line) | Small single values |

Starter cards don't copy dictionary text into the database: a row only stores the entry's id in `deck.json`
(`deck_id`) plus anything you change. A row is created the first time a word is introduced, so the tables only hold
words you've actually seen.

## The tables

| Table | One row per | Notes |
| --- | --- | --- |
| `idn_sources` | channel, stream, account, song, game… | Where words and immersion time came from |
| `idn_sentences` | sentence you mined | Text, translation, source |
| `idn_cards` | word or phrase you're learning | Either a `deck_id` (starter word) or your own text |
| `idn_schedule` | card × direction (recognise / recall) | FSRS state: when it's due, stability, difficulty |
| `idn_reviews` | review | The full history; the schedule can always be rebuilt from it |
| `idn_sessions` | stretch of study or immersion | Minutes per day for the 5 h week |
| `idn_notes` | grammar note | Your notes under each lesson, or free-standing |
| `idn_drills` | drill answer | Numbers/time/affix accuracy over time |

`idn_review(…)` saves a review and its new schedule in one step, and ignores a review it has already saved, so the
offline queue can safely resend.

## One-time setup

In Supabase: **SQL Editor → New query**, paste everything below, **Run**. It should say *Success. No rows returned*.
Then check **Table Editor**: every `idn_` table shows **RLS enabled**.

```sql
-- ---------- sources and mined sentences ----------
create table public.idn_sources (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  title       text        not null,
  kind        text        not null default 'other'
              check (kind in ('vtuber', 'video', 'stream', 'song', 'social', 'chat', 'game', 'webtoon', 'other')),
  url         text,
  created_at  timestamptz not null default now()
);

create table public.idn_sentences (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  text        text        not null,
  translation text,
  source_id   uuid        references public.idn_sources on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------- cards ----------
-- A starter card has deck_id (an entry in data/deck.json) and leaves the text fields empty unless you edit them.
-- Your own card has no deck_id and fills in at least `indonesian` and `english`.
create table public.idn_cards (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  deck_id     text,
  indonesian  text,                                 -- casual form, as shown on the card
  formal      text,                                 -- standard form, if different (gak → tidak)
  english     text,
  root        text,
  register    text        check (register in ('casual', 'neutral', 'formal', 'slang')),
  example     text,
  example_en  text,
  notes       text,
  tags        text[]      not null default '{}',
  active      boolean     not null default false,   -- also review English → Indonesian (typed)
  suspended   boolean     not null default false,
  source_id   uuid        references public.idn_sources on delete set null,
  sentence_id uuid        references public.idn_sentences on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, deck_id),
  check (deck_id is not null or (indonesian is not null and english is not null))
);

-- ---------- scheduling (FSRS) ----------
create table public.idn_schedule (
  card_id     uuid        not null references public.idn_cards on delete cascade,
  direction   text        not null check (direction in ('recognise', 'recall')),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  state       smallint    not null default 0,       -- 0 new, 1 learning, 2 review, 3 relearning
  due         timestamptz not null default now(),
  stability   real        not null default 0,
  difficulty  real        not null default 0,
  reps        int         not null default 0,
  lapses      int         not null default 0,
  last_review timestamptz,
  primary key (card_id, direction)
);

create index idn_schedule_due on public.idn_schedule (user_id, due);

-- Every review ever done. client_id is made by the page, so a review resent from the offline queue is saved once.
create table public.idn_reviews (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  client_id   uuid        not null,
  card_id     uuid        not null references public.idn_cards on delete cascade,
  direction   text        not null check (direction in ('recognise', 'recall')),
  rating      smallint    not null check (rating between 1 and 4),   -- 1 again, 2 hard, 3 good, 4 easy
  duration_ms int,
  reviewed_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index idn_reviews_user_time on public.idn_reviews (user_id, reviewed_at);

-- ---------- time ----------
-- study: counted by the pages while they're in use. immersion: logged by hand (watching a stream, reading a thread).
create table public.idn_sessions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  day         date        not null,
  kind        text        not null check (kind in ('study', 'immersion')),
  activity    text        not null default 'other'
              check (activity in ('review', 'new', 'lesson', 'drill', 'mining', 'reading', 'writing',
                                  'listening', 'watching', 'speaking', 'other')),
  minutes     numeric(6, 1) not null default 0 check (minutes >= 0),
  source_id   uuid        references public.idn_sources on delete set null,
  note        text,
  started_at  timestamptz not null default now()
);

create index idn_sessions_user_day on public.idn_sessions (user_id, day);

-- ---------- notes and drills ----------
create table public.idn_notes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  lesson      text,                                 -- lesson id from data/lessons.json, or null
  title       text        not null,
  body        text        not null default '',
  updated_at  timestamptz not null default now()
);

create table public.idn_drills (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  kind        text        not null,                 -- 'number', 'price', 'time', 'date', 'affix', …
  prompt      text        not null,
  answer      text,
  correct     boolean     not null,
  at          timestamptz not null default now()
);

create index idn_drills_user_kind on public.idn_drills (user_id, kind, at);

-- ---------- rules: signed-in users only, own rows only (same as kv and statements) ----------
do $$
declare t text;
begin
  foreach t in array array['idn_sources', 'idn_sentences', 'idn_cards', 'idn_schedule', 'idn_reviews',
                           'idn_sessions', 'idn_notes', 'idn_drills'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- saving a review ----------
-- Records the review and the card's new schedule together (all or nothing). A client_id that was already saved is
-- ignored, so resending from the offline queue is safe. Returns false for such a duplicate.
create or replace function public.idn_review(r jsonb, s jsonb)
returns boolean
language plpgsql
security invoker            -- runs as the signed-in user, so the rules above still apply
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into public.idn_reviews (client_id, card_id, direction, rating, duration_ms, reviewed_at)
  values ((r->>'client_id')::uuid, (r->>'card_id')::uuid, r->>'direction', (r->>'rating')::smallint,
          (r->>'duration_ms')::int, coalesce((r->>'reviewed_at')::timestamptz, now()))
  on conflict (user_id, client_id) do nothing;

  if not found then
    return false;
  end if;

  insert into public.idn_schedule as cur
    (card_id, direction, state, due, stability, difficulty, reps, lapses, last_review)
  values ((r->>'card_id')::uuid, r->>'direction', (s->>'state')::smallint, (s->>'due')::timestamptz,
          (s->>'stability')::real, (s->>'difficulty')::real, (s->>'reps')::int, (s->>'lapses')::int,
          coalesce((r->>'reviewed_at')::timestamptz, now()))
  on conflict (card_id, direction) do update set
    state = excluded.state, due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
    reps = excluded.reps, lapses = excluded.lapses, last_review = excluded.last_review
  -- an older review arriving late from another device's offline queue doesn't overwrite a newer schedule
  where cur.last_review is null or cur.last_review <= excluded.last_review;

  return true;
end;
$$;

revoke execute on function public.idn_review(jsonb, jsonb) from public, anon;
grant execute on function public.idn_review(jsonb, jsonb) to authenticated;
```

## Second step: the PDF library table

Added after the first setup. `python tools/build-indonesian.py sync` (also part of `tools/update-indonesian.bat`) uploads what
it extracted from your PDFs here, signed in as you, so the pages can use it without an import screen: extra
examples and derived forms on cards, and topic sets (greetings, food, family…) to add as new cards. Run this once in
the SQL Editor, the same way as above:

```sql
-- What tools/build-indonesian.py extracted from your PDFs. Private like everything else; the script upserts by id, so
-- running it again adds and updates rows. Rows for deleted PDFs stay unless the script runs with --prune.
create table public.idn_library (
  id          text        not null,                 -- stable id from the script (file + text)
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  kind        text        not null,                 -- word, derived, phrase
  indonesian  text        not null,
  english     text        not null,
  lemma       text,                                 -- matching dictionary word, if any
  root        text,
  also        text[]      not null default '{}',    -- other forms given with it (makan, memakan)
  pos         text,
  example     text,
  example_en  text,
  topic       text,                                 -- worksheet topic or book title
  file        text,
  page        int,
  status      text,                                 -- in-deck, dictionary, new (when it was uploaded)
  deck_pos    int,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index idn_library_lemma on public.idn_library (user_id, lemma);

alter table public.idn_library enable row level security;
create policy "own rows" on public.idn_library for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.idn_library from anon;
grant select, insert, update, delete on public.idn_library to authenticated;
```

The script asks for your Supabase email and password each time; set `IDN_EMAIL` and `IDN_PASSWORD` to skip the
prompt (like `BCP_PDF_PASSWORD` for the statements).

## Checking it worked

1. **Table Editor** lists the eight `idn_` tables, each with **RLS enabled**.
2. **Authentication → Policies** shows one "own rows" policy per table.
3. **Database → Functions** lists `idn_review`.

Nothing else is needed until the first page exists.

## Things to know

- **Deleting a card** deletes its schedule and review history (`on delete cascade`). Suspending it (`suspended`)
  keeps them.
- **Deleting a source or sentence** keeps the cards and sessions that pointed to it; the link is just cleared.
- **Rebuilding the Python data** never touches these tables. Starter words keep their `deck_id`, so a better
  gloss in `deck.json` simply shows up on your existing card (unless you've edited that field on the card).
- **Size**: a year at the plan's pace is roughly 2,500 cards, 3,000 schedule rows and 30–40,000 reviews, a few MB,
  well inside Supabase's free tier.
- **Changing a table later**: add columns with `alter table public.idn_cards add column …;` in the SQL Editor. New
  tables need the same four rule lines as in the loop above.
- **Starting over**: `drop table` the `idn_` tables (cards last, or use `cascade`) and `drop function
  public.idn_review(jsonb, jsonb);`, then run the setup again.
