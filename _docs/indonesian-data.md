# Indonesian data: `tools/build-indonesian.py`

Builds the files the Indonesian pages ([indonesian.md](indonesian.md)) load, so the browser only reads lookup tables:
no stemming, parsing or ranking in the page. Also reads your own Indonesian PDFs into a **private** library and
uploads it to your database, so the pages can use it without any import screen.

```
python tools/build-indonesian.py         public data   -> personal/learning/indonesian/data/
python tools/build-indonesian.py pdfs    private       -> adds your PDFs to tools/indonesian/out-private/library.json
python tools/build-indonesian.py sync    private       -> uploads the library to the idn_library table (asks you to sign in)
python tools/build-indonesian.py all     all three (what tools/update-indonesian.bat runs)
  --prune                          with pdfs/sync/all: also remove entries of PDFs no longer in the folder
```

The public build takes about 25 seconds; the PDF step a few more (unchanged PDFs aren't read again).

## Setup (once)

1. `pip install PySastrawi pyyaml` (PyMuPDF is already installed for `tools/parse-statements.py`).
2. Download into `tools/indonesian/raw/` (git-ignored, about 100 MB):

   | File | From |
   | --- | --- |
   | `kaikki.org-dictionary-Indonesian.jsonl` | <https://kaikki.org/dictionary/Indonesian/kaikki.org-dictionary-Indonesian.jsonl> |
   | `ind_sentences.tsv.bz2` | <https://downloads.tatoeba.org/exports/per_language/ind/ind_sentences.tsv.bz2> |
   | `ind-eng_links.tsv.bz2` | <https://downloads.tatoeba.org/exports/per_language/ind/ind-eng_links.tsv.bz2> |
   | `eng_sentences.tsv.bz2` | <https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2> |
   | `id_50k.txt` | <https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/id/id_50k.txt> |

   Re-download now and then for dictionary fixes; the script works with whatever is there.

## What it builds (public)

Everything here is freely licensed and committed with the site; licences are in
[data/CREDITS.md](../personal/learning/indonesian/data/CREDITS.md) and `manifest.json`.

| File | Contents |
| --- | --- |
| `deck.json` | The learning order: 3,000 words. Each: `id` (stable, = the word; what `idn_cards.deck_id` stores), `w` word, `g` meaning, `p` part of speech, `reg` register (casual/neutral/formal/slang), `rank` (frequency), optional `std` (standard form of a casual word: *gak* → *tidak*), `r` root, `pr` pronunciation with *ê* for the schwa, `x` example sentence ids or `xi` an inline example, `sl` + `n` + `also` for hand-written casual words |
| `sentences.json` | Only the example sentences the deck uses: `{ id: [indonesian, english] }` |
| `lexicon/<letter>.json` | The whole dictionary (32,000 words) in 27 shards, loaded only when needed. Per word, one entry per part of speech: `p`, `s` senses (`g` gloss, `t` tags, `to` the word it's a form of, `x` example), `pr`, `r` root, `af` affixes |
| `forms.json` | Inflected and casual forms → `[dictionary word, root]` (empty string = same as the form). Words that are their own dictionary entry and root aren't listed |
| `families.json` | Root → the words built on it (*tulis* → *menulis, tulisan, penulis…*), for the affix pages |
| `slang.json` | Every casual and chat spelling → `{ std, en, kind, note }`, or `{ see: main form }` for alternative spellings |
| `manifest.json` | Version, a short hash and size per file, counts, sources. Pages compare it with what they cached |

### How the deck is chosen

1. Words in order of the subtitle frequency list, each mapped to its dictionary word: clitics (*-nya, -ku, -mu,
   -lah*) and casual affixes (*nulis* → *tulis*, *bacain* → *baca*) are undone, then the PySastrawi stemmer.
2. Passive and *-lah* forms are folded into their base word (*dilakukan* → *lakukan*); casual spellings keep their
   own card, with the standard form beside them.
3. The meaning is the dictionary's everyday sense, with cross-references resolved ("synonym of datang" → "to arrive").
4. The hand-written casual words from `slang.yaml` are mixed in from position 20, one every 10 words (80 in total).
5. Examples: the Tatoeba sentence that is short and whose other words are the most common, up to 3 per word.

## Editing content

Both files are in `tools/indonesian/content/` (hand-written, committed), then re-run the build.

- **`slang.yaml`**: casual, chat and streaming words. `deck: true` puts a word in the deck, in file order. `also`
  lists other spellings (they get no card of their own).
- **`overrides.yaml`**: `gloss` replaces a deck word's meaning; `roots` fixes a root (`null` hides it); `skip`
  keeps words out of the deck (names that are frequent in subtitles).

Changing a meaning never touches your progress: cards store the word's `id`, and a card you've edited keeps your text.

## Your PDFs (private)

Drop Indonesian PDFs in `tools/indonesian/pdfs/` (git-ignored) and run `python tools/build-indonesian.py pdfs`. The
public build has to exist first, since words are checked against it.

Each PDF is recognised by its layout:

| Parser | Layout | Example files |
| --- | --- | --- |
| `cards` | "CARD 001", `root, form ~ meaning`, a bold example + translation, numbered derived forms | The 300-word card books |
| `word-list` | Word, part of speech, `=meaning` columns | 200 Common Indonesian Words |
| `pairs` | An "Indonesian / Meaning" table; or bold Indonesian with plain English beside or below it; or numbered sentences with smaller English underneath | The writing worksheets |
| `reading` | A long book of Indonesian text without translations | The Grade 5 textbook (for reading practice later) |

Skipped and reported: password-protected or scanned PDFs (no text layer), and PDFs that don't contain Indonesian.

### The library is cumulative

`tools/indonesian/out-private/library.json` (git-ignored) keeps everything ever extracted, so the PDF folder doesn't
have to keep every file:

| You… | Next run |
| --- | --- |
| add a PDF | its entries are added |
| change a PDF (new version) | its old entries are replaced by the new ones |
| rename a PDF | recognised by its content; entries kept, nothing re-read |
| delete a PDF | its entries **stay** (reported as kept); `--prune` removes them |
| leave a PDF as it is | not read again |

After every run, all entries (old ones too) are matched again against the current deck and dictionary, so a rebuilt
deck updates their status.

Each entry has `kind` (word, derived, phrase), `indonesian`, `english`, optional `root`, `also`, `pos`,
`example`/`example_en`, `topic`, the `file` and `page` it came from, and `status`:

- `in-deck`: already in the deck (`deck_pos` says where), so it adds an example, a root or a derived form to a word
  you'll learn anyway
- `dictionary`: a real word that isn't in the deck
- `new`: not found in the dictionary (phrases, compounds, or a misread)

### Upload (`sync`)

Sends the library to the `idn_library` table (create it first: second step in
[indonesian-database.md](indonesian-database.md)), signed in with your Supabase account so the table's own-rows rule
applies. Rows are added and updated by id; with `--prune`, rows no longer in the library are deleted. Set
`IDN_EMAIL` and `IDN_PASSWORD` to skip the sign-in prompt. If you're offline, the library stays saved locally and the
next `sync` sends it.

The pages then use it directly:

- **Review**: a card shows the PDF's example sentence for its word and the derived forms the card books list for its
  root.
- **Today → From your PDFs**: each worksheet topic is a set ("Greetings", "Ordering food", …). **Add** turns its words
  into new cards that come before the deck order (still within the daily new-card limit): deck words are pulled
  forward, the rest become your own cards.

**Nothing from the PDFs goes into the public data**: most of them are copyrighted. It only exists in the git-ignored
library file and in your own database rows.

## Known limitations

- The order comes from film and TV subtitles, so *kau* (common in subtitles, songs and stories) ranks above *kamu*,
  and dramatic words (*bajingan*, *membunuh*) come earlier than in daily chat. The slang list balances this for chat.
- Wiktionary's glosses are sometimes long or technical. Fix the ones you meet in `overrides.yaml`, or edit the card.
- Some names still slip through from subtitles; add them to `skip`, or suspend the card.
- A rebuild rewrites about 6 MB of data files, so commit after content changes, not after every run.
