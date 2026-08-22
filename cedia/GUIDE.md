# RACK & ROLL '26 — the crew playbook (internal)

For Sam, Connor, and Pearl. Not for the booth wall. This is how the game runs.

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

1. Have a real thirty-second conversation. This is a gift after a chat, not a
   flyer. (Also: as visitors, not exhibitors, keep it person-to-person —
   handing cards in aisles reads as soliciting; a card after a conversation
   does not.)
2. Hand them a card from *your* stack. "I met Sam at CEDIA and he invited me to
   play." The card has a QR and a typed code as backup.
3. That's it. They scan → rules → their codename (non-negotiable) → name, bio,
   optional email + photo → they're on the board. New players sort to the top,
   so they'll see themselves the second they join.

## How to let *them* invite others (delegation)

Someone you recruited is well-connected and wants to hand out invites too?

- **Give them a few of your physical cards.** Anyone they sign up still counts
  toward *your* recruiter number — you vouched for the person who vouched for
  them. That's the current model: invites flow down from the three of you.
- Only give cards to people you'd actually vouch for. The whole thing runs on
  "someone thought you were interesting"; a stack in the wrong hands makes it a
  flyer.
- (If the game gets legs after CEDIA, letting players mint their own invites is
  the obvious next feature — ask Jane to build it. For the show, physical cards
  from your stack is the delegation mechanism.)

## The board

`rickroll.win/leaderboard` — public. Two tables: **players** by people-rolled,
and the **recruiter race** (you three, by claims). Everyone starts at zero and
the newest player sorts to the top, so it never looks empty and nobody feels
behind for being new.

## If something goes wrong

- **Someone puts up something gross.** `rickroll.win/admin.html` on your phone,
  enter the admin secret (in 1Password / Sam's keychain), hide or nuke that
  page. There's also a global "photos off" switch.
- **A QR won't scan** (bad light, glossy card). Every card has the typed code —
  they go to `rickroll.win`, tap "present credentials," type it.
- **The video won't play** on someone's phone. It's just the pre-roll; it
  auto-dismisses in a few seconds and there's a Skip button. Their page still
  works.

## Rule zero

You do not talk about RACK & ROLL. (You do share your page.)
