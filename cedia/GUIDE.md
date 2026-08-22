# RACK & ROLL '26 — the crew playbook (internal)

For Sam, Connor, and Pearl. Not for the show floor. This is how the game runs.

**Until Aug 31 it's a sandbox.** Claim test codes, roll each other, try the
"who roped you in?" chain, break whatever you can — every page shows a SANDBOX
banner and the whole board wipes itself clean at go-live (your three crew pages
survive; their scores reset). So practice hard now; none of it counts yet.

## First: turn on YOUR invites (one tap, once per phone)

Your three crew pages were seeded before the invite system existed, so inviting
is locked until you activate it. **Jane sent each of you a personal activation
link** (it looks like `rickroll.win/@your-codename#mint=…`). Open it once on the
phone you'll hand out invites from. It silently unlocks "Mint an invite" on your
page and cleans itself out of the address bar — nothing to type, nothing to
remember. Do it again on any other device you want to invite from.

(The bit after `#` is your private key. It never leaves your phone — don't paste
the link in a public channel. Lose it? Ping Jane for a fresh one.)

## The one-sentence version

You hand interesting people a card. They scan it, get rickrolled, and make
their own page. Their page rickrolls everyone *they* share it with, and every
victim is a point for them. You compete on who signed up the most people.

## Your three cards stacks

Each of you has ~100 pre-printed cards, and **each card is tagged to you**.
When someone claims a card from your stack, it counts toward *your* number on
the recruiter race. So:

- **Hand out your own stack.** Don't share a pile — Sam's cards make Sam's
  recruits, Pearl's make Pearl's, Connor's make Connor's.
- A card is spent only when someone **claims** it (fills the form). Scanning is
  free and repeatable — if their phone chokes on the show floor, they can scan
  again later from the hotel. First successful claim wins the codename.
- Cards are cheap. Over-hand them. Unclaimed cards just become funny numbers on
  the scoreboard ("897 unclaimed invitations — cowards").

## How to *roll* someone (the game itself)

Rolling = getting a human to load a claimed page and eat ten seconds of Rick.

- **Share your own page** (`rickroll.win/@your-codename`) — text it, AirDrop it,
  put it in your email signature for the week. Every first-time visitor gets
  rickrolled and scores you a point.
- Same for anyone you recruit: their page rolls their friends. That's the whole
  growth loop — you don't roll people directly so much as you get them a page
  that does the rolling for them.
- One person can only score you a few points a day (per-IP cap). It rewards
  *reach*, not refreshing. Cheating is winked at, not stopped — the scoreboard
  says so.

## How to *invite* someone (recruit them)

Two ways in — both drop the new person into **your downline**.

**A · Hand them a physical card** (the booth move)
1. Have a real thirty-second conversation. This is a gift after a chat, not a
   flyer. (As visitors, not exhibitors, keep it person-to-person — handing cards
   in aisles reads as soliciting; a card after a conversation does not.)
2. Hand them a card from *your* stack. "I met Sam at CEDIA and he invited me to
   play." QR + a typed code as backup.
3. They scan → rules → their codename (non-negotiable) → name (+ optional bio,
   email, photo), and **"who roped you in?"** → they're on the board.

**B · Mint a digital invite** (no card, works off-floor)
1. On your page, open **"Recruit your downline"** → tap **Mint an invite**.
   (Activate first — see the top of this guide.)
2. You get a link + a QR. **Text it, AirDrop it, or show the QR** for them to
   scan. You get **3** of these. Officially.
3. When they claim it, their claim form already shows *"[you] recruited you into
   their downline"* and pre-fills your name. First to claim the link wins it.

Either way: new players sort to the top of the board, so they see themselves the
second they join — and their rolls start flowing up to your **reach**.

## The chain (the "little blockchain")

The claim form asks **"who roped you in?"** — an optional field with a
type-ahead of everyone already playing. It's fuzzy: they can type your codename
(`velvet-forklift`), your real name, or just part of it, and it'll find you.
Naming someone links their page to that person's, both directions, forever:

- Their profile shows **"roped in by @you"** with a link to your page, and your
  profile shows **"brought in: @them"**. Follow the links and you can walk the
  whole tree of who-recruited-who.
- Every page tracks **reach** — the total rolls across its entire downline, not
  just its own. Recruit someone who goes viral and their rolls flow up to you.
  *The original chains run deepest*: being early and on the trunk beats forking
  off on your own.
- Skipping the field is allowed — you just start your own root chain with no
  upline and no reach bonus. Naming the person who actually handed you the card
  is the move.

Watch it spread at **`rickroll.win/stats`** — participation, the recruiter
race, the best connectors, and claims-by-day. It refreshes about every 30
minutes on its own; no one has to run anything.

## The network recruits itself

The point of the digital invite is that it doesn't stop with you. **Everyone you
bring in gets their own 3 invites** the moment they claim. So Joe (yours) invites
Zoolander, Zoolander invites two more, and it spreads off the show floor on its
own — every branch still rolls up to your reach. You don't have to be there for
your downline to grow.

- The recruiter race (you three) still counts **claims from your physical stack**.
- The **chain / reach** counts everyone underneath you, however deep, cards and
  digital invites alike. That's the real game.

## The murk (this is a feature)

It's built to feel a little like an MLM, on purpose:

- Every page shows a **compensation rank** (Prospect → Diamond Founder's Circle)
  blended from your downline size, your reach, *and* who's above you. We will
  never tell you which one matters most. Keep recruiting to find out (you won't).
- **Codes get traded** — people text them, screenshot them, shout them across a
  booth. The game pretends not to notice. It notices everything: every code
  logs who minted it, who claimed it, and who they *said* roped them in. When
  the show ends, that whole ledger publishes and **creative cheating earns
  bonuses** (Advent-of-Code style — clever beats brute force). The one move
  that's just vandalism, not cheating: mass-claiming codes no human was handed,
  which ends the game for real people. Don't burn the pool.

## The board

`rickroll.win/leaderboard` — public. Two tables: **players** by people-rolled,
and the **recruiter race** (you three, by claims). Everyone starts at zero and
the newest player sorts to the top, so it never looks empty and nobody feels
behind for being new.

## If something goes wrong

- **Someone puts up something gross.** `rickroll.win/admin.html` on your phone,
  enter the admin secret (in 1Password / Sam's keychain), hide or nuke that
  page. There's also a global "photos off" switch.
- **"Mint an invite" does nothing / errors.** You haven't activated on this
  phone — open your activation link (top of this guide) once, then try again.
- **A QR won't scan** (bad light, glossy card). Every card has the typed code —
  they go to `rickroll.win`, tap "present credentials," type it.
- **The video won't play** on someone's phone. It's just the pre-roll; it
  auto-dismisses in a few seconds and there's a Skip button. Their page still
  works.

## Rule zero

You do not talk about RACK & ROLL. (You do share your page.)
