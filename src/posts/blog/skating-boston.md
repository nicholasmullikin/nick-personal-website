---
title: "Boston Skating"
category: "Projects"
date: "2026-05-22 18:00:00 +00:00"
desc: "Why a weekend project turned into skating.boston."
thumbnail: "./images/skating-boston/thumbnail.jpg"
alt: "skating.boston rink map"
---

In the Boston winter of 2024, I started ice skating, but when winter turned to spring I found that I had to keep opening up the same annoying rink websites. So I decided to just make my own site that combines the data from all of them.

Turns out it's a bit harder than it looks since every rink has a completely different website and needs to get pull from regularly.

So I built [skating.boston](https://skating.boston).

![skating.boston map of public skating in greater Boston](./images/skating-boston/Screen Shot 2026-05-25 at 16.47.00.png)

## Why this exists

There are, broadly, two kinds of "the website has the data":

1. The data is _in the page_ in a structured way you can scrape.
2. The data is in _a person's brain_ and the website happens to host it too.

Public skating in Massachusetts is split roughly 50/50 between those two categories. So I started writing parsers.

## How many types of data are there

I know have **49 rink-specific parsers** for all the different rinks around. Here are the broad categories

| Pattern                                       | Example rinks                              | What you actually parse                              |
| --------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| REST API with date range                      | MIT, Babson, Arlington, Falmouth, Bourque  | JSON over `POST` with `start`/`end`                  |
| Form-encoded `POST`                           | Medford                                    | `application/x-www-form-urlencoded` calendar request |
| Server-rendered HTML                          | Daly, DCR, Edge, Woburn                    | `goquery` over the calendar page                     |
| iCal/`.ics`                                   | Peabody                                    | `BEGIN:VEVENT` blocks                                |
| Embedded JS variable                          | Harrison, Mullins, Warriors, Foxboro       | Regex out `_activityList = [...]` from the HTML      |
| "We don't have a feed, but here's a sentence" | Lossone, North Adams, NorthStar, Watertown | Generate events from the published recurring hours   |

And some very strange ones where it looks like a normal calendar, but underneath it's a bare HTML page with a JavaScript variable like:

```javascript
_activityList = [
  {
    "ActivityId": 20324,
    "Name": "1. Learn to Ice Skate",
    "ActivityStartDate": "2025-10-27T00:00:00",
    "DisplayActivityType": "Skating School",
    "DisplayFacility": "Gurry Rink",
    ...
  },
  ...
];
```

## Quirks I'd rather not have learned

Some of the things I now know, against my will:

- **Daly Rink lies about timezones.** Their HTML has `datetime='2025-02-23T15:00:00+00:00'` but renders "3:00 pm" in Eastern. The `+00:00` is decorative. The parser strips the `+00:00`, ignores it, and reconstructs the time in `America/New_York`.
- **North Adams' calendar is stuck in 2017.** Their Google Calendar is real, but every event has an `RRULE` that expired in 2017. Meanwhile, the rink's website has the actual hours in plain text — "Monday through Friday 3:00 pm – 5:00 pm, Friday Nights 8:00 pm – 10:00 pm, Saturday and Sunday 2:00 pm – 4:00 pm." So the parser ignores the calendar feed entirely and generates a rolling two-month window of events from the published hours.
- **NorthStar publishes their schedule as an image.** Not even a PDF. A JPG on the homepage. I read it with my eyes, transcribed it into Go, and the parser now generates Saturday/Sunday 1:00–2:30 pm events starting from the season opener.
- **FMC's `CalendarLabel` is fuzzy.** Strings like "Worcester - Ice Sheet" needed an explicit O(1) location map to all 26 FMC rinks. Generic edit-distance matching gave scores of 7+ and produced hundreds of warning logs per ingest run. Sometimes the dumbest fix (a `map[string]string`) is the right one.

## What I learned

I can go skate on [skating.boston](https://www.skating.boston/):

<iframe
  src="https://www.skating.boston/"
  style="width:100%; height:600px; border:none;"
  title="skating.boston - Find public skating times in Boston"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
  sandbox="allow-scripts allow-same-origin allow-popups"
  allowfullscreen
></iframe>
