# Show HN draft

URL: https://studio.sonyasupposedly.com/startups/

## Title options (80 characters max)

1. Show HN: The last 100 startups mentioned in HN comments, as soap bubbles
2. Show HN: The startups HN commenters keep mentioning, and you can merge them
3. Show HN: The Last 100 Startups – a live map of startups mentioned on HN

## Text

I wanted to know which startups people here actually talk about, as opposed to which ones launch or raise money. So I built a page that reads every Hacker News comment (plus Show HN and Launch HN posts), picks out the companies being mentioned, and shows the 100 most recently mentioned startups as a clump of soap bubbles. Each bubble is sized by its mentions over the last 30 days, counting each commenter once per thread. It updates every 20 minutes.

Tap a bubble to see what the company does, what it has raised, and the latest comment that mentioned it. Drag one bubble onto another to merge them into a new (fake) startup, complete with a pitch, a funding round, and a skeptical HN comment. Or drag a bubble into one of the Big Tech mouths at the bottom to sell it. Companies that really have been acquired move to "Recently devoured".

How it works:

- Comments come from the Algolia HN API.
- Moonshot's Kimi reads them and lists the companies each one names.
- TypeSafe's Jev decides what counts as a startup (young, independent and private; not public, acquired, a household name or a single-purpose tool), checked against web searches for funding and acquisitions.
- The server is plain Node with node:sqlite and no npm dependencies. The bubbles are Matter.js.

"What counts as a startup" is the part I'm least sure of, and there are a few editorial calls in there. Corrections welcome.

Mergers are cached, so if you merge two companies someone else already merged, you'll get their deal.
