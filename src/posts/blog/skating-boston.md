---
title: "I just wanted to know when I could go skate"
category: "Projects"
date: "2026-05-22 18:00:00 +00:00"
desc: "Why a single Saturday afternoon turned into 49 ice rink scrapers, a Postgres database, and skating.boston."
thumbnail: "./images/skating-boston/thumbnail.jpg"
alt: "skating.boston rink map"
---

A couple of winters ago I tried to take my partner public skating.

That should be a five-minute task. Pick a rink, look up the hours, drive over. But Boston-area public skating is genuinely hard to plan, and not because the rinks are hiding. They publish their schedules. They publish them on dozens of incompatible websites, in formats ranging from "modern REST API" to "we took a photograph of a printed flyer and stuck it on the homepage."

So I built [skating.boston](https://skating.boston).

![skating.boston map of public skating in greater Boston — TODO replace with real screenshot](./images/skating-boston/thumbnail.jpg)

## Why this exists

I had, in front of me, the [DCR rink schedule PDF](https://www.mass.gov/doc/dcr-public-skating-schedule-2024-2025/download), the [Daly Rink](https://www.dalyrink.org/calendar/) HTML calendar, [FMC's POST endpoint](https://fmcicesports.com/rinks/), Watertown's "Sundays starting Nov 13" plain-text blurb, and a 2017 Google Calendar from a North Adams parks-and-rec page that nobody has touched since the Obama administration.

There are, broadly, two kinds of "the website has the data":

1. The data is _in the page_, in a structured way you can scrape.
2. The data is in _a person's brain_, and the page contains, at best, a hint that they remember it.

Public skating in Massachusetts is split roughly 50/50 between those two categories. So I started writing parsers.

## The data layer of the web is a mess

There are now **49 rink-specific parsers** in `pkg/parsers/`, plus a handful of multi-rink ones (FMC, DCR, VAHockey, StinkySocks). Most of them follow one of these patterns:

| Pattern                                       | Example rinks                              | What you actually parse                              |
| --------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| REST API with date range                      | MIT, Babson, Arlington, Falmouth, Bourque  | JSON over `POST` with `start`/`end`                  |
| Form-encoded `POST`                           | Medford                                    | `application/x-www-form-urlencoded` calendar request |
| Server-rendered HTML                          | Daly, DCR, Edge, Woburn                    | `goquery` over the calendar page                     |
| iCal/`.ics`                                   | Peabody                                    | `BEGIN:VEVENT` blocks                                |
| Embedded JS variable                          | Harrison, Mullins, Warriors, Foxboro       | Regex out `_activityList = [...]` from the HTML      |
| "We don't have a feed, but here's a sentence" | Lossone, North Adams, NorthStar, Watertown | Generate events from the published recurring hours   |

The Finnly Connect pattern is particularly funny. The rink's website _looks_ like a normal calendar, but underneath it's a bare HTML page with a JavaScript variable like:

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

There is no API. There is just a regex:

```go
re := regexp.MustCompile(`_activityList\s*=\s*(\[.*?\]);`)
```

FMC's API, by contrast, is genuinely a JSON endpoint, but the URL looks like someone fell asleep on the keyboard:

```
https://fmc.myhalix.io/event/sandboxes/sbx~00~300/scope/business/biz~00~-wcAAAAAAAA~AQA/publicEvents
```

I'm assured these are URL-safe Base64-encoded UUIDs, and not, say, modem line noise.

## Quirks I'd rather not have learned

Some of the things I now know, against my will:

- **Daly Rink lies about timezones.** Their HTML has `datetime='2025-02-23T15:00:00+00:00'` but renders "3:00 pm" in Eastern. The `+00:00` is decorative. The parser strips the `+00:00`, ignores it, and reconstructs the time in `America/New_York`.
- **North Adams' calendar is stuck in 2017.** Their Google Calendar is real, but every event has an `RRULE` that expired during the Trump–Pence administration. Meanwhile, the rink's website has the actual hours in plain text — "Monday through Friday 3:00 pm – 5:00 pm, Friday Nights 8:00 pm – 10:00 pm, Saturday and Sunday 2:00 pm – 4:00 pm." So the parser ignores the calendar feed entirely and generates a rolling two-month window of events from the published hours.
- **NorthStar publishes their schedule as an image.** Not even a PDF. A JPG on the homepage. I read it with my eyes, transcribed it into Go, and the parser now generates Saturday/Sunday 1:00–2:30 pm events starting from the season opener.
- **FMC's `CalendarLabel` is fuzzy.** Strings like "Worcester - Ice Sheet" needed an explicit O(1) location map to all 26 FMC rinks. Generic edit-distance matching gave scores of 7+ and produced hundreds of warning logs per ingest run. Sometimes the dumbest fix (a `map[string]string`) is the right one.

## Architecture

The shape of the system is boring on purpose:

- **Scrapers**: Go programs in `cmd/ingest/` and `pkg/parsers/`. Each parser returns `[]db.Event` with pricing already computed. Logging happens in a shared `IngestSingleRink` / `IngestMultiRink` wrapper, so parsers stay pure.
- **Database**: Postgres. Two tables that matter: `rinks` (static metadata, lat/lon, prices) and `schedules` (events, with a `source` column matching the parser).
- **API**: Go + Air for hot reload during development. REST endpoints serve filtered `schedules` joined to `rinks` by source.
- **Frontend**: Vite + React + TypeScript + TailwindCSS, with [Leaflet](https://leafletjs.com/) for the rink map and [React Big Calendar](https://github.com/jquense/react-big-calendar) for the schedule view. Filters for cost, indoor/outdoor, and event type.

Adding a new rink is now a three-step exercise — drop metadata into `pkg/db/rinks_data.go`, write a parser that returns `[]db.Event`, and register it in `singleRinkRegistry` (or `multiRinkRegistry` for sources like FMC that cover multiple rinks). I wrote the runbook for myself in [`NEW_INGESTION.md`](https://github.com/nicholasmullikin/ice-skating-website/blob/main/NEW_INGESTION.md), and it has saved me from re-learning the same edge cases at least four times.

## What I learned

The thing I actually learned from this project is that "the data is on the web" and "the data is usable" are completely different statements. There is, _somewhere_, a person at every one of these rinks who knows when public skating is. Sometimes that knowledge is published as a JSON endpoint. More often it's published as a sentence, an image, or a PDF that gets re-uploaded every November and forgotten in March. The hard work is not making the API. The hard work is being the person who refuses to give up until the website's data and the person's brain agree.

Also: I now know more about [DCR's seasonal closures](https://www.mass.gov/info-details/dcr-ice-skating-rink-schedule), [Mazevo's API](https://api.rectimes.com/), and [the difference between a `mazevo` booking and a `RecTimes` booking](https://app.rectimes.com/) than any non-rink-employee should[^1].

But I can finally answer the question I started with.

I can go skate on Saturday.

[^1]: Mazevo and RecTimes are both event-management products that white-label themselves to facility operators; they speak slightly different JSON dialects and use venue IDs that you have to find by snooping browser network traffic. They are both, somehow, easier than parsing HTML.
