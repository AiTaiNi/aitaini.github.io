# Indonesian: plan for the learning pages (`personal/learning/indonesian/`, not built yet)

Private pages for learning Bahasa Indonesia, on the same sign-in and storage as the other personal pages. This file
is the design; nothing is built yet.

- Database setup (tables, rules, how to add them in Supabase): [indonesian-database.md](indonesian-database.md) (done)
- The 1-year study plan the pages follow: [indonesian-study-plan.md](indonesian-study-plan.md)
- The data script, its outputs and the PDF library: [indonesian-data.md](indonesian-data.md) (built)

**Built so far** (step 1 of the build order): the Learning index, **Today** (numbers, plan month, session outline,
topic sets from your PDFs, immersion log, settings), **Review** (FSRS, recognise and typed recall, audio, examples,
your PDFs' examples and derived forms, suspend), the hub tile and the two Calendar tasks. Shared code: `idn.js`
(data, settings, deck order and recall cards, time tracker, summary) on top of the site-wide flashcard engine
`/assets/srs.js` (scheduling, card store, offline queue; [flashcards.md](flashcards.md)), and `idn.css`. Not yet: Words, Affixes, Drills,
Mine, Slang, Lessons, Log, Speak, Credits.

## The learner

| | |
| --- | --- |
| Translations | **English only** |
| Level | Beginner (some Duolingo, mostly forgotten) |
| Goal | Recreational: follow Indonesian VTubers and creators, read and write casual text (chat, comments, social media) |
| Register | **Colloquial first**, formal for recognition later |
| Time | About 1 h on study days, **5 h a week** |

So: reading and writing come first, listening grows alongside through the content itself, speaking is optional.
Words are chosen by how often they appear in casual speech and online text, not by textbook order, and every
card shows the casual form first with the formal one beside it (*gak* · *tidak*, *udah* · *sudah*).

## Why this needs its own pages

Indonesian is easy to start (no conjugation, gender or tones, phonetic spelling) and hard to get fluent in because of:

1. **Affixes.** Meaning lives around a root (*kata dasar*): *ajar* → *belajar* (study), *mengajar* (teach),
   *pelajaran* (lesson), *diajarin* (casual: be taught). The prefix *meN-* also changes the root's first sound
   (*tulis* → *nulis* casual / *menulis* formal, *kirim* → *ngirim* / *mengirim*).
2. **Registers.** What's taught (*saya, tidak, sudah, bagaimana*) and what's said and typed (*aku/gue, gak, udah,
   gimana*, particles *sih, dong, kok, deh, kan, lho, nih*, and internet spelling *yg, bgt, gw, wkwk*) differ a lot.
   VTuber chat and social media are almost entirely the second.

## Site layout

Everything lives under `/personal/learning/indonesian/`, with a small `/personal/learning/` index so other subjects
can be added later.

| Page | Path | What it does |
| --- | --- | --- |
| Learning index | `/personal/learning/` | One tile per subject (Indonesian for now) |
| Today | `/personal/learning/indonesian/` | Today's session: reviews due, new words, this week's lesson, time so far, streak, links to the rest |
| Review | `…/review/` | The flashcard session (spaced repetition) |
| Words | `…/words/` | Search and browse the dictionary and your cards, add or edit cards, a root's word family |
| Affixes | `…/affixes/` | Affix reference and drills (root + affix → word, word → root) |
| Drills | `…/drills/` | Numbers, prices, time, dates; listening versions |
| Mine | `…/mine/` | Paste a sentence (stream chat, a comment, a post), tap unknown words to make cards |
| Slang | `…/slang/` | Casual ↔ formal pairs, internet abbreviations, particles and what they do |
| Lessons | `…/lessons/` | The plan's weekly grammar points, short and example-led, plus your own notes |
| Log | `…/log/` | Study and immersion time (manual entries for watching streams), weekly 5 h progress, month checkpoints |
| Speak | `…/speak/` | Shadowing and pronunciation check (later) |
| Credits | `…/credits/` | Sources and licences of the prepared data |

Shared code for these pages (spaced repetition, data loading, the time tracker) goes in one script in the
Indonesian folder, loaded by each page, the way `/assets/tasks.js` is shared by the calendar pages.

## Features

### Cards and reviews

- A card is a word or phrase: Indonesian (casual form), formal form, English meaning, example sentence with
  translation, root, register (casual / neutral / formal / slang), tags, and where you met it.
- Two directions. **Recognise** (Indonesian → English) for every card. **Recall** (English → Indonesian, typed,
  ignoring case and accents) only for cards marked *active*, which you want to write yourself. That keeps the daily
  load fitting the 5 h week.
- Scheduling with **FSRS**: fewer reviews than older methods for the same retention. It's a short formula, written
  into the shared script rather than pulled in as a library. Target retention 90%.
- Daily limits for new cards, set by the study plan (10 on study days, none at weekends; see the plan).
- Audio from the browser's own speech (`id-ID` voice: good on Android and Chrome; Windows needs the Indonesian
  language pack). Optional pre-made audio later (see the data pipeline).
- Reviews done offline (installed app) are kept on the device and uploaded when back online.

### Affixes

- Every word knows its root, so each root shows its family: the quickest way to understand affixes.
- Drills both ways, casual and formal (*meN- + tulis* → *nulis* / *menulis*; root of *ngirim*?), with the
  sound-change rule shown after a miss.
- Casual affixes get the same treatment as textbook ones: *-in* (replaces *-kan/-i*: *bacain, kasih tau*),
  *nge-/N-* (*ngomong, nulis, ngecek*), *ke-* (passive-ish *kebawa, ketipu*), *-an* (*mainan*).
- Reduplication: plurals (*anak-anak*, typed *anak²* online), casual activity (*jalan-jalan*), fixed words
  (*kupu-kupu*).

### Drills

Numbers and prices in rupiah (*dua ratus lima puluh ribu*; dots for thousands; *goceng*, *ceban*, *gopek*), time
(*setengah tiga* = 2:30), dates and days, and durations. Each has a typing mode and a listening mode (hear it, type
it). Short, 2–5 minutes, and they fill odd moments.

### Sentence mining

- Paste a line from a stream chat, a comment, a tweet or a caption; known words are coloured, unknown ones tap into
  cards with the sentence as their example.
- Lookups come from the prepared dictionary (below), so this works without any online dictionary.
- Casual spellings are normalised for lookup (*bgt* → *banget*, *gw* → *gue*, *yg* → *yang*) using the prepared
  slang list, and shown as such.
- Sources (channels, streams, accounts) are saved, so you can see where your words come from.

### Slang & particles

A reference you'll actually use for chat: particles with what they add (*dong* = urging, *sih* = softening or
"though", *kok* = surprise "how come", *deh* = "fine, then"), common casual words (*banget, aja, emang, gimana,
kayak, doang*), internet abbreviations and laughter (*wkwk, awokwok*), and VTuber/streaming terms (*kak, chat,
donasi, nyanyi, karaoke, gacha*). Each item can become a card.

### Lessons

One short lesson per week from the study plan (pronouns, negation, time words, *yang*, affixes, *-nya*…), each with
examples from the prepared sentences and a link to its words. Your own notes sit under each lesson. Notes are plain
text with a small built-in formatter (headings, bold, lists, links) rather than a Markdown library.

### Time and the 5 h week

- Study time is counted automatically while a study page is open, visible and being used (no input for a minute
  pauses it).
- Watching a stream or reading a thread counts too, logged by hand on the Log page as **immersion**, kept apart
  from study time so the 5 h target stays about focused practice.
- The Log page shows the week's study hours against 5 h, immersion hours, words learned, and the month checkpoints
  from the plan.

### Speaking (later, optional)

Shadowing (play a sentence, record yourself, compare), and a pronunciation check with the browser's speech
recognition in `id-ID` (Chrome only, sends audio to Google, so it's opt-in each time).

## On the hub and the Calendar

- **Hub tile** "Indonesian", with a live line: `34 due · 25 of 60 min · 12-day streak`. Like Expenses, the study
  pages save a tiny summary key the hub reads, so the hub never loads cards.
- **Two daily tasks** on the Calendar/Today, kept in step by the study pages:
  - **Indonesian reviews**: a plain task, ticked when today's due reviews reach zero. Every day, weekends included,
    since spaced repetition needs it.
  - **Indonesian study**: a counter of 15-minute blocks (target 4 = 1 h), filled by the time tracker. On review-only
    days it simply stays partly filled.
- This needs one more small addition to `/assets/tasks.js`, the same idea as `Tasks.syncEvents`: a call for a page
  to own a daily task (id prefix `idn-`) and set its count for a day, after `Sync.ready()`.

## Data: prepared in Python, personal data in Supabase

The heavy parts (a dictionary, word frequencies, roots, example sentences, slang mapping) would be slow and
library-hungry to do in the browser. They're prepared once on the PC by a Python script and published as plain
JSON files the pages just load. **Only your own progress goes in the database**: cards you've added, review history,
scheduling state, sources, mined sentences, notes and study time.

### What the script builds

`tools/build-indonesian.py` (next to `tools/parse-statements.py`), run with `tools/update-indonesian.bat`. Raw downloads
go in `tools/indonesian/raw/` (git-ignored); hand-written content in `tools/indonesian/content/` (YAML, in git);
output in `personal/learning/indonesian/data/` (in git, public, no personal data).

| Output | Built from | Used by |
| --- | --- | --- |
| `lexicon/*.json`: dictionary in shards by first letter (casual and formal forms, English glosses, part of speech, root, register, frequency rank) | Wiktionary entries via kaikki.org's machine-readable extract, frequency list, slang list | Words, Mine, Review |
| `forms.json`: every inflected or casual form → its dictionary entry and root | Frequency list words run through a stemmer (PySastrawi) plus casual affix rules (*nge-*, *-in*) | Mine (lookups), Affixes |
| `deck.json`: the ordered learning list (about 3,000 entries) with an example sentence each | Frequency rank weighted towards spoken/online text, minus names and noise | Today, Review (new cards come from here in order) |
| `sentences.json`: short example sentences with translations, indexed by word | Tatoeba Indonesian–English pairs | Cards, Lessons |
| `slang.json`: casual and internet forms → standard form, with notes | A colloquial Indonesian lexicon plus hand-written entries | Mine, Slang |
| `lessons.json`, `drills.json`, `phrases.json`, `plan.json` | Hand-written YAML | Lessons, Drills, Today, Log |
| `manifest.json`: version and hash of every file | The script | All pages: fetch only what changed; the service worker caches them for offline |

Sizes stay browser-friendly: the deck and forms load up front (a few hundred KB, compressed by GitHub Pages), the
lexicon shards only when a word starting with that letter is looked up.

### Why this split

- The browser never stems, parses dumps or ranks words: it reads lookup tables.
- No front-end libraries beyond supabase-js: FSRS, the time tracker and the note formatter are small enough to write.
- Database rows stay small: a starter card stores only a reference to its `deck.json` entry and your scheduling
  state. Only cards you write yourself store their full text.
- Rebuilding the data (better word list, fixed glosses) never touches your progress, because entries keep stable ids.

### Optional extras for later

- **Your own frequency list**: run the script on subtitle files of the channels you watch (kept in the git-ignored
  raw folder, like the statement PDFs). It outputs word counts only, imported into your private data through the
  page, so new cards favour the words those creators actually use.
- **Pre-made audio** for the deck and sentences with an offline Indonesian text-to-speech voice (Piper has one),
  as small files in the data folder, for devices without a good built-in voice.

### Licences

The page code and these data files are public, so every source must allow it, and the Credits page names them:
Wiktionary/kaikki.org (CC BY-SA, so the built dictionary is CC BY-SA too), Tatoeba (CC BY 2.0 FR), the frequency
list (e.g. FrequencyWords from OpenSubtitles, CC BY-SA 4.0), PySastrawi (MIT). **Check each licence when the script
is written**, especially the colloquial lexicon and any TTS voice; anything unclear stays out or is replaced by
hand-written entries.

## Build order

1. **Data script, phase 1**: deck, sentences, forms, slang. **Database tables.** **Review + Today pages**, the
   hub tile and the two daily tasks. Usable from day one of the plan.
2. **Words** (dictionary, root families, own cards) and **Log** (time, immersion, checkpoints).
3. **Lessons** (weeks 1–13 content first) and **Drills**.
4. **Mine** and **Slang**, before the plan's month 4, when sentence mining starts.
5. **Affixes**, before month 4–5, when affixes become the focus.
6. **Speak**, extras (own frequency list, audio).
