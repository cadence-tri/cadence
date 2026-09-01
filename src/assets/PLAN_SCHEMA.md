# Training Plan Format — Governance Document

## Current Coach contract (scheduler v5)

New Coach prompts use `cadence-coach-v4`, not the expanded markdown template
below. The remainder of this document is the legacy expanded-format reference;
its full governance text is not appended to v5 prompts. The executable contract
is in `src/services/planning/coachProtocol.js` and the local plan validator.

The AI returns one JSON object with `protocol`, the exact `blockId`, and
`sessions`. Every session has its short `id` (for example `S1`), `title`,
optional `notes`, and either optional endurance `cues` or gym `sets`.
Cadence reconstructs dates, phases, Optional flags, totals and exact endurance
steps from the saved locked schedule; the AI must not echo or change them.
Every upcoming session appears once in the readable `SESSION TASKS` response
manifest. Its declared total, endurance/gym counts and ordered `EXPECTED IDS`
list are authoritative. The AI must return exactly one response entry per line;
the packed context supplies supporting evidence but is not used for task discovery.
Each gym set must carry one exact movement `slot` from its readable GYM line.
Upper body uses upperPush/upperPull/shoulder/core; lower body uses
squat/hinge/singleLeg/core; full body uses
squatOrHinge/upperPush/upperPull/singleLegOrCarry/core. Cadence orders these
slots, derives the canonical title/focus and identifies core locally. Missing,
duplicate or unknown slots block the whole import. If every slot is valid,
Cadence restores the exact main/core set and repetition targets locally and
shows a non-blocking import warning when it corrects them. Suggested loads are
also restored locally and are never accepted from the AI. Optional status is
never used to repair an invalid gym response.
Missing/duplicate/unknown IDs, stale blocks and malformed replies are rejected.
Generated sessions retain a stable scheduler ID for deduplication even if their
titles change; legacy sessions still use date/discipline/title fallback matching.

Input uses a purpose-built coaching view before applying the lossless transport
codec. Cadence keeps the complete database records and immutable schedule
locally. The AI receives all athlete profile/check-in data, athlete feedback,
structured workout results, one semantic summary of each prior endurance
prescription, completion counts, complete prior gym exercise sets, upcoming
locked targets and exact cue step IDs/labels. Import IDs/timestamps,
`originalPrescription`, duplicated completed endurance sets, internal
fingerprints and old step-level AI cues are not coaching evidence and are not
sent. The upcoming schedule embeds short response IDs directly in its sessions.

The focused view is losslessly encoded for transport: `@D0` references
dictionary D0; `["#R0", ...values]` uses ordered keys from schemas.R0;
`["#P", "D0", index, value, ...]` copies a decoded base and replaces zero-based
properties. A leading `!` escapes literal marker strings. Other arrays remain
arrays. Large prompts are warned about, never silently truncated. Character
count is not token count and compatibility with a specific external model is
not guaranteed.

Marathon peak ranges (45–55 / 55–65 / 75–85 km per week) are adaptive targets,
not required quotas. Capacity, completion, recovery and explicit time limits
can keep a plan below them. Long runs progress separately within the weekly
budget. Assessments occur once per development phase per discipline when
placement permits, never in recovery/taper; normal work develops between them.
Race distance is excluded from training-volume progression. Goals never certify
current fitness, and numerical baseline changes require athlete confirmation.

---

**Purpose:** every plan written in this project has two audiences at once —
the athlete, reading human-friendly coaching prose, and Cadence, parsing the
structured session JSON. This document is the single source of truth for that
dual structure. Read it before writing or editing any plan output. If the
schema changes, update this document together with Cadence's session model,
importer, scheduler/validator contract, and the bundled copy under
`src/assets/` so they never drift apart.

The generic skeleton in §1 is the canonical **formatting example**. It is
deliberately athlete-, date-, sport-, and week-number-neutral. For hybrid
blocks, Cadence's locked schedule is authoritative for dates, week labels,
disciplines, phases, and target totals; never infer those values from an
example.

---

## 1. File-level structure

Every plan file is markdown, written for a human first. Machine-parseable
data is embedded, not separate. The recurring shape:

````
# <Plan title>

**Athlete:** ...
**Goals:** ...
**Approach:** ...            (only in the season-roadmap file)

## Macro Roadmap              (only in the season-roadmap file — a table of
                               phases, windows, durations, and focus)

## Nutrition                  (as needed)

## Week N (date range) — <short goal line>
**Phase:** <phase name>       ← only needed once per file/section if it's
                                  obvious from context; the JSON `phase`
                                  field is the one the app actually reads,
                                  this heading is for the human reader

<day-by-day prose: headers, bullet lists of prescribed work>

```session
[ ... one JSON object per session that day, for the whole week ... ]
```

## Week N+1 ...
<same pattern, own ```session block>

## Notes
<free-text coaching notes, questions for next check-in, etc.>
````

Rules:
- **One `session` fenced block per week**, placed right after that week's
  prose (not interleaved per-day — follow the generic skeleton above).
- The block is a JSON **array**, even for weeks with only one session on
  some days — consistency matters more than minimalism.
- A day with two sessions (e.g. swim + gym) gets **two array items**
  sharing the same `date`. A day with a "choose one" alternative (e.g.
  long run vs. long bike) also gets two array items sharing the same
  `date`, distinguished by title ("Option A" / "Option B") and a `notes`
  string telling the athlete to pick one.
- **Never put literal triple-backticks in the surrounding prose.** They
  prematurely close or merge fences and break parsing. Refer to the block
  in words ("a hidden session block") if you need to mention it at all.

---

## 2. The session object — field reference

Every item in a week's JSON array is one session:

| Field | Type | Required | Notes |
|---|---|---|---|
| `date` | string `"YYYY-MM-DD"` | **yes** | Exact ISO date, no time component. |
| `skeletonId` | string | required for Cadence hybrid-generated blocks; otherwise optional | Opaque ID copied exactly from Cadence's locked schedule. It lets the importer validate the AI response against the deterministic session. Do not invent or alter it. Legacy/manual imports may omit it. |
| `skeletonRole` | string | required for Cadence hybrid-generated blocks; otherwise optional | Echo the locked scheduler role (`easy`, `quality`, `long`, `brick`, `strength`, etc.) exactly. Used only for validation and not stored in the session database. |
| `brickTargets` | object | required for hybrid-generated `brick` sessions; otherwise optional | Echo Cadence's locked `{ bikeKm, runKm }` values exactly. Used for validation and not stored permanently. |
| `discipline` | string | **yes** | One of: `swim`, `bike`, `run`, `brick`, `gym`, `rest`, `other`. Case-insensitive on import, but always write lowercase. Anything else imports under "Other" with a warning — never silently dropped, but also never what you want on purpose. |
| `title` | string | **yes** | Short, human-readable. **Keep stable across re-imports of the same day** — the app de-duplicates on `date + discipline + title`; changing the title for an already-imported day creates a duplicate instead of updating it. |
| `phase` | string | recommended | The macro training phase this week belongs to. Must exactly match one of the six governed phase names (§3). Omit only for one-off/ungoverned content; every regular week should have it. |
| `weekLabel` | string | **required for Cadence hybrid-generated blocks; otherwise recommended** | E.g. `"Week 9"`. For hybrid blocks, copy the locked Cadence `weekLabel` exactly into every session and use the same label in the `## Week N` heading. Never infer/restart numbering from worked examples. |
| `totalDistance` | number | **yes**, for `swim`/`bike`/`run` | Total distance for the *whole session*, not a single rep — see below. Omit for `gym`/`rest`/`other`; for `brick`, only include it if the whole session is one clean unit (rare — usually skip it and let the per-segment distances in `sets` carry the detail instead). |
| `notes` | string | optional | Coach context for this specific session (form cues, "choose one" instructions, injury flags, etc). |
| `sets` | array of set objects | optional | The structured prescription. Omit or leave empty for a plain rest day with no structured content. |

**`totalDistance` units are discipline-dependent — this is the one field
in the schema where that's true, so don't default to meters everywhere
out of habit:**

- `bike` and `run`: **kilometers**, e.g. `10` for a 10km run, `42.195`
  for a full marathon.
- `swim`: **meters**, e.g. `1500` for a 1500m swim, matching how the
  athlete already logs pool distance and how `sets[].distanceM` is
  already written.

This is deliberately a *whole-session* total, separate from any per-rep
`distanceM` values inside `sets` (§4). A session's `sets` frequently only
cover part of the prescribed distance — warm-up/cool-down or "easy"
portions are often written as `duration` (time) rather than `distanceM`,
so summing `sets[].distanceM` under-counts what the athlete actually
covered. `totalDistance` is what the app's Stats weekly-volume charts
read; without it, a swim/bike/run session won't show up in that chart at
all (it falls back to a rougher, duration-based estimate instead — see
§5). Always include it for swim/bike/run, even when it's an estimate
(e.g. "~10km" in the prose becomes `"totalDistance": 10` in the JSON —
drop the `~` and unit, keep the number).

Canonical field order (cosmetic only, but keep it consistent for
readability): `skeletonId` (when supplied by Cadence), `skeletonRole` (when supplied by Cadence), `date`, `phase`, `discipline`, `title`, `weekLabel`,
`totalDistance`, `notes`, `sets`.

---

## 3. Phase names — the governed list

`phase` must be exactly one of these six values (case/spacing-insensitive on
import — see the app's `TrainingPhase.parse` — but always write it in this
canonical form in plan files):

- `Build-up`
- `Endurance`
- `Peak`
- `Taper`
- `Recovery`
- `Maintenance`

This is the one list, used the same way whether the block is a marathon or
an Olympic-triathlon build — the macro-cycle shape doesn't depend on
discipline, so there is deliberately no separate phase vocabulary per sport.
`Maintenance` is also the app's default for any week nobody has explicitly
labelled — don't rely on that default in a plan file; set the field
explicitly on at least one session per week regardless of phase.

This list is a closed set matching the app's `TrainingPhase` enum
(`Models/WeekPhase.swift`) exactly, case for case. If it ever needs to
change — a phase renamed, split, or added — update this list **and** the
Swift `TrainingPhase` enum (plus `TrainingPhase.color` in `AppTheme.swift`)
in the same pass; they must never drift apart. Do not reintroduce a
per-discipline or per-roadmap-phase vocabulary (e.g. "Marathon-Specific
Build" vs "Triathlon-Specific Build") without updating both sides together.

**Recovery weeks in Cadence hybrid plans are scheduler-owned.** The deterministic
scheduler inserts planned deload weeks and locks their `Recovery` phase before
the AI sees the block. Do not add, remove, or move a recovery week in a hybrid
generation. For legacy/manual plans without a locked schedule, avoid long
uninterrupted loading stretches and include periodic recovery/deload weeks.

---

## 4. The set object — field reference

Every item in a session's `sets` array is one prescribed line:

| Field | Type | Applies to | Notes |
|---|---|---|---|
| `exercise` | string | all | Name of the drill/lift/segment, e.g. `"Squat"`, `"Freestyle"`, `"Warm up spin"`. |
| `setsCount` | int | mainly gym, also swim reps | The "3" in "3x8". |
| `reps` | int | mainly gym | The "8" in "3x8". |
| `weightKg` | number | gym | Load. Use a plain number, not a string — `65`, not `"65kg"`. |
| `suggestedWeightKg` | number | generated gym | Cadence's current working suggestion. Kept separate from `weightKg`, which is the athlete's actual logged load. |
| `loadAction` | string | generated gym | Local evidence-led action: establish, hold, addRep, increaseLoad, or reduce. |
| `distanceM` | number | swim/run/bike | Distance of this rep/segment in **meters**, plain number. |
| `duration` | string | all, esp. time-based work | Free text like `"20'"`, `"15'"`, `"20-25'"` (ranges get averaged by the app). Always use a trailing `'` for minutes and `"` for seconds, matching the athlete's existing shorthand. |
| `paceOrPower` | string | endurance | E.g. `"5'40\"/km"`, `"180W"`, `"~2'00\"/100m"`. |
| `rest` | string | interval work | E.g. `"15\""`, `"2' rest"`, `"as needed"`. |
| `notes` | string | any | Per-line detail that doesn't fit elsewhere (e.g. "per side", "after 10x40kg WU"). |

All set fields are optional — use whichever apply. A rest-day mobility
line might only have `exercise` + `duration` + `notes`; a squat working
set will have `exercise`, `setsCount`, `reps`, `weightKg`, and often a
`notes` on the warm-up.

**JSON string escaping:** any `"` inside a string value (feet/inches-style
time notation, e.g. `20"` for seconds) must be escaped as `\"`. This is
standard JSON, not a special app requirement, but it's the single most
common syntax slip when transcribing the athlete's own shorthand — always
double-check before shipping a plan.

---

## 5. Why the schema is shaped this way (context for future edits)

- **Every set field is optional, one shape covers all disciplines.** This
  was a deliberate simplification so the app's data model (`SessionSet`)
  doesn't need a different type per discipline. Don't invent
  discipline-specific fields (e.g. `strokeCount` for swim) without
  updating both this doc and the Swift model — and consider first whether
  an existing field (`notes`) can carry it instead.
- **`duration` is a string, not a number.** The athlete's own shorthand
  (`"20-25'"`) is a range, and forcing it into a single number would lose
  information. The app parses this leniently for stats (`SessionSet.
  durationMinutes`) — ranges get averaged.
- **De-dup key is `date + discipline + title`.** This makes re-importing
  an updated file for weeks already logged safe (new/changed sessions get
  added, unchanged ones are skipped) — but it means the title is load-
  bearing, not just cosmetic. Don't casually reword a title on a
  re-generated week if the athlete may have already imported the old one.
- **Unrecognized `discipline` values import under "Other," never crash or
  drop.** If you're tempted to introduce a discipline not in the governed
  list (§2), that's a schema change — update the Swift `Discipline` enum
  and this document together, don't just start emitting a new string.
- **`totalDistance` is session-level and unit-varies by discipline, on
  purpose.** Stats used to sum `sets[].distanceM` for weekly volume, but
  that quietly under-counted real distance — plenty of sets (warm-ups,
  "easy" portions, anything logged as `duration` instead) carry no
  `distanceM` at all, so the sum only ever reflected part of the session.
  A single, explicit whole-session number is more accurate and much
  simpler for the app to trust. The unit split (km for bike/run, m for
  swim) isn't a inconsistency to "fix" — it matches how distance is
  already written everywhere else in these plans and in the athlete's own
  log (`Triathlon_training.pdf`), so converting it to one unit
  everywhere would just add a translation step for no benefit. If a
  session genuinely has no sensible total (most `gym`/`rest`/`other`,
  and most `brick`s split across two disciplines), omit the field rather
  than forcing a number — the app falls back to a duration-based volume
  estimate for that session instead of failing.

---

## 6. Checklist before finalizing any plan file

- [ ] Every week's prose has a matching `\`\`\`session` block placed right
      after it.
- [ ] Every session object has `date`, `discipline`, `title`, and — for
      any regular week — `phase` and `weekLabel`. For Cadence hybrid-generated
      blocks, `weekLabel` is locked: it must exactly match the label supplied
      by Cadence for that calendar week.
- [ ] Every `swim`/`bike`/`run` session has a `totalDistance` — km for
      bike/run, meters for swim (§2). Double-check the unit, not just
      the presence of the field: a bike ride entered in meters (or a
      swim entered in km) will silently wreck that week's Stats chart.
- [ ] `phase` values are copy-pasted from §3, not paraphrased.
- [ ] Titles are stable/sensible for re-import (won't collide oddly with
      earlier imports of the same day).
- [ ] No stray triple-backticks anywhere in the prose.
- [ ] JSON is valid — every `"` inside a string is escaped, no trailing
      commas. Worth a quick `json.loads()` sanity pass before delivering.
- [ ] Set-level fields use the right types (numbers for `weightKg`/
      `distanceM`/`setsCount`/`reps`, strings for everything else).
- [ ] Weekly volume matches the athlete's profile distance/phase per §7's
      table — not a volume left over from a previous, different target.
- [ ] Every prescribed pace/power is derived from the athlete's goal time
      per §7, not copied forward unchanged from an older block written for
      a different goal or distance.
- [ ] If the goal-derived pace is more than ~8-10% faster than what the
      historical log actually demonstrates, that mismatch is flagged in
      the plan's Notes section (§7) rather than silently prescribed.
- [ ] Session-days per week never exceed `trainingDaysPerWeek` (§7.5) —
      count two-a-days as one day, not two.
- [ ] Discipline scope matches `sport` exactly (§7.6): no swim/bike for a
      running-only athlete (gym stays in); at least one brick per week for
      a triathlete.
- [ ] Doubles and the week's longest session land on the listed
      higher-time dates (§7.5.1), not on an arbitrary day.
- [ ] The `Experience tier: ...` line's modifiers (§7.7 — weekly increase
      cap, rest-day minimum, quality-session cap, cueing detail) are
      actually reflected in the prescribed week, not just acknowledged
      in prose.
- [ ] Any flagged past injury or ongoing condition is reflected in an
      actual prescription adjustment (§7.8), not just repeated back in
      Notes verbatim.
- [ ] Lifestyle recovery bias (§7.9), when applicable, is visible in
      where volume sits within the phase's §7.1 range — not silently
      ignored.

---

## 7. Athlete target governance — volume, pacing, and goal-driven prescription

**This section is binding, not advisory.** Every plan generated in this
project must be sized and paced from the athlete's profile target — the
selected event distance (`RunningDistance` or `TriathlonDistance` in
`Models/RaceDistance.swift`) and goal time(s) (`AthleteProfile.
goalOverallTime`/`goalSwimTime`/`goalBikeTime`/`goalRunTime`) — not from
generic defaults, and not just carried forward from whatever volume the
historical log happens to already show. The check-in prompt built by
`PlanPromptBuilder` includes a `Target race: ...` line stating exactly
this; treat it the same way you'd treat a `phase` value from §3 — copy the
distance and goal faithfully into the volume/pacing decisions below, don't
paraphrase or ignore it because the log "looks like" a different level.

### 7.1 Weekly volume by distance and phase

These are **starting ranges**, meant to be nudged by the athlete's actual
demonstrated capacity in the log (§7.3), not applied as rigid numbers
regardless of history. Running volumes are total run km/week (all
sessions combined); triathlon volumes are per-discipline weekly km (swim in
km, not meters, for this table only — convert when writing `totalDistance`
per §2's unit rule).

**Running**

| Distance | Build-Up | Endurance | Peak | Taper |
|---|---|---|---|---|
| 5K | 15-25 km | 25-35 km | 30-40 km | 15-20 km |
| 10K | 20-30 km | 30-45 km | 40-55 km | 20-25 km |
| Half Marathon | 25-35 km | 35-55 km | 50-65 km | 25-35 km |
| Marathon | 30-45 km | 45-70 km | 65-85 km | 30-45 km (2-3 week taper) |

**Triathlon** (weekly totals per discipline)

| Distance | Phase | Swim | Bike | Run |
|---|---|---|---|---|
| Sprint | Build-Up→Peak | 4-8 km | 60-120 km | 15-30 km |
| Olympic | Build-Up→Peak | 6-12 km | 100-180 km | 20-40 km |
| Half Ironman | Build-Up→Peak | 8-15 km | 150-280 km | 25-45 km |
| Ironman | Build-Up→Peak | 10-18 km | 200-350+ km | 30-55 km |

Taper: cut all three disciplines to roughly 40-60% of Peak volume, same
"one clear rest day, no new stress" logic as any taper. Within each cell,
scale toward the lower bound for an athlete newer to the distance or
returning from a break in the log, and toward the upper bound for an
athlete whose recent log already shows consistent volume near or above the
Build-Up number — this is the "nudge by demonstrated capacity" adjustment
mentioned above.

### 7.2 Deriving pace and power from the goal time

**Running (`goalOverallTime` + `RunningDistance.distanceKm`):**
1. Goal race pace = goal time ÷ distance.
2. Easy/Z2 pace ≈ goal race pace + 45-75"/km slower.
3. Threshold/tempo pace ≈ goal race pace + 10-20"/km slower (tighter gap
   for 5K/10K goals, wider for marathon goals, since marathon race pace
   itself sits closer to threshold).
4. VO2/interval pace ≈ goal race pace − 10-20"/km faster, held only for
   short reps (per §4's `duration`/`rest` fields), never for the bulk of a
   session's volume.
5. Write every derived pace explicitly into `sets[].paceOrPower` — never
   leave it as "race pace" in prose without a number, per the existing
   "fully explicit" rule already in the check-in prompt.

**Triathlon (`goalOverallTime` and/or per-leg splits):**
1. If a leg split (`goalSwimTime`/`goalBikeTime`/`goalRunTime`) is present,
   use it directly for that leg's pace/power derivation (swim: pace per
   100m; bike: target average speed → estimate power from the athlete's
   own historical W/log if available, otherwise a Z2/tempo band relative
   to their logged FTP-adjacent efforts; run: same as the running formula
   above using the leg distance).
2. If a leg split is missing, derive it proportionally from
   `goalOverallTime` using rough age-group split proportions as a starting
   point, then sanity-check against the log (§7.3):
   - Sprint/Olympic: swim ≈ 10-12%, T1+T2 ≈ 3-5%, bike ≈ 50-55%, run ≈
     28-32% of overall time.
   - Half/Full Ironman: swim ≈ 8-10%, T1+T2 ≈ 2-3%, bike ≈ 53-58%, run ≈
     30-35% of overall time (bike share grows, transition share shrinks,
     relative to the shorter distances).
3. State in the plan's Notes whenever a split was derived rather than
   athlete-supplied, so the athlete knows it's an estimate to refine, not
   a number they typed themselves.

### 7.3 Sanity-checking the goal against the log

Before finalizing paces, compare the goal-derived race pace/power against
what the historical log actually demonstrates (recent tempo runs,
threshold intervals, FTP-adjacent bike efforts, recent swim pace per
100m). If the goal implies a sustained pace/power more than roughly 8-10%
faster than the best comparable effort already logged, don't silently
prescribe it as if it were already achievable — call this out explicitly
in that week's `## Notes` section (e.g. "your 10K goal implies ~4'15"/km
race pace; your best recent tempo effort was ~4'40"/km, so this block
targets closing that gap rather than assuming it's already there") and
pace the actual prescribed sessions off the log-demonstrated fitness for
now, trending toward the goal pace as the block progresses. This keeps
§7.2's formulas from generating an unsafe or demoralizing plan when the
goal is aspirational rather than already-fit.

### 7.4 Fallback when no target is set

`DistanceAndGoalSection` defaults every profile to a sane distance
(Marathon / Olympic) even before the athlete fills in a goal time, so
there's always a distance to size volume from (§7.1). If `goalOverallTime`
(and, for triathlon, all three leg splits) is blank — the "no goal time
set" / "no overall goal set" text the prompt substitutes in for an empty
field — pace sessions off the athlete's own demonstrated log paces
(§7.3's method, without a goal to compare against) rather than inventing a
number, and note in that block's `## Notes` that a goal time would let
future blocks be paced more precisely.

### 7.5 Weekly training frequency vs. distance — the capacity check

`AthleteProfile.trainingDaysPerWeek` is the athlete's own stated ceiling on
how many *days* a week they can realistically train — deliberately a day
count, not a session count, because two sessions can share a day (run +
gym, swim + gym, a brick) without needing an extra day free, and asking
"how many sessions" makes athletes either undercount (forgetting gym
counts) or overcount (double-booking a day they don't actually have
twice). The check-in prompt's `availabilityLine` states this number, and —
if it falls below the distance's recommended minimum — the exact same
warning text the athlete already saw and dismissed on the profile screen
(`TrainingCapacityWarning`, mirrored in the table below so the two stay in
sync):

| Distance | Recommended min. training days/week |
|---|---|
| 5K | 3 |
| 10K | 3 |
| Half Marathon | 4 |
| Marathon | 5 |
| Sprint triathlon | 4 |
| Olympic triathlon | 5 |
| Half Ironman | 6 |
| Ironman | 7 |

**This table must stay in sync with `RunningDistance.minTrainingDaysPerWeek`
and `TriathlonDistance.minTrainingDaysPerWeek` in `Models/RaceDistance.swift`
— if one changes, update the other in the same pass.**

When `trainingDaysPerWeek` is at or above the table's minimum, plan
normally. When it's below (the athlete was warned and chose to continue
anyway — the prompt says so explicitly), **never invent extra training
days to hit §7.1's volume**. Instead:
- Cap the plan at exactly `trainingDaysPerWeek` distinct calendar days per
  week — a two-a-day (e.g. swim + gym on the same date) still only uses
  one of those days, even though it's two `session` JSON objects sharing
  one `date`.
- Make each day carry more — longer or more purposeful sessions, or a
  second session stacked on the same day — rather than adding days:
  combine easy volume into fewer, longer aerobic sessions; use bricks
  (§7.6) to cover two disciplines in one day for a triathlete; prioritize
  the session types that matter most for the goal (e.g. for a marathon on
  2 training days/week, one long run + one quality/threshold day beats two
  easy-run days — cut easy volume before cutting the session that actually
  builds race fitness).
- Say so plainly in that block's `## Notes`: name the gap between
  recommended and actual frequency, and what got prioritized/cut as a
  result, so the athlete understands the trade-off rather than assuming
  the compressed plan is equivalent to the full-frequency version.

#### 7.5.1 Higher-time days — where doubles and long sessions go

`AthleteProfile.longSessionDays` marks which weekdays the athlete has more
time available (evenings free for a second session, a whole free morning
for a long run, etc.) — independent of `trainingDaysPerWeek`'s count. The
check-in prompt's `longSessionDatesLine` converts this into the *actual
calendar dates* falling in the 2-week block being generated, so placement
should be exact, not "some day around midweek":

- Whenever a plan needs a double session (two disciplines/session-types on
  one day) or the single longest session of the week (the long run, the
  long ride, the key brick), place it on one of the listed higher-time
  dates first — that's what they're for.
- Keep the *other* training days shorter and single-purpose: one session,
  a duration that fits an ordinary weekday, nothing that assumes the
  athlete has evening time they didn't mark.
- If no higher-time dates are listed (`longSessionDatesLine` says "No
  specific higher-time days marked"), fall back to spreading structure
  evenly across the week — put the long session wherever the weekly rhythm
  best supports recovery (e.g. not immediately before a key quality
  session), same as this document's guidance before this field existed.
- This is a placement preference, not a volume override — §7.1's totals
  and §7.5's day-count cap still apply; higher-time days just decide
  *which* days absorb the week's biggest chunks of that volume.

### 7.6 Discipline scope — what belongs in the plan at all

The prompt's `disciplineLine` states this explicitly per block; follow it
exactly rather than defaulting to old habits from a previous athlete's
plan:

- **Running-only athletes (`sport == running`): no swim or bike sessions,
  ever.** The plan is running + gym/strength & conditioning + rest days
  only. Gym/S&C is NOT optional here — it stays in for cross-training and
  injury prevention regardless of sport, same as every other block (the
  "every week includes ... strength & conditioning" rule earlier in this
  document was never sport-conditional, and running-only plans don't get
  an exception). Do not add bike or swim sessions "for cross-training" —
  that's what the gym block is for in a running-only plan; introducing an
  extra discipline the athlete never asked for or logged before is a
  scope violation, not a helpful addition.
- **Triathletes (`sport == triathlon`): swim, bike, and run all belong,
  plus at least one brick session per week.** A brick (already a valid
  `discipline` value per §2) combines two disciplines back-to-back in one
  session — almost always bike→run, occasionally swim→bike — and is
  mandatory, not optional, for a triathlete's plan: race-day transitions
  are a distinct skill/adaptation that pure single-discipline training
  doesn't build. If `trainingDaysPerWeek` is tight (§7.5), a brick is one
  of the most efficient ways to cover two disciplines in a single day, not
  just a specialty session to fit in when there's room — and a
  higher-time day (§7.5.1) is the natural home for it.

### 7.7 Athlete experience tier — binding progression modifiers

Every plan explicitly targets one of three experience tiers, computed from
onboarding answers (and log depth once one exists) and stated directly in
the check-in prompt as an `Experience tier: ...` line — treat that line as
authoritative. It's computed once, deterministically, by the app itself
(`experienceTierLine` in `planPromptBuilder.js`), specifically so the tier
doesn't drift between different AI tools/models generating different
blocks for the same athlete — don't re-derive it from scratch or override
it based on a hunch about the log.

- **Beginner** — cap weekly volume increases at **5%** block-to-block
  (tighter than the general ~7% baseline elsewhere in §7.1). Never
  schedule two hard/quality sessions on consecutive days. Guarantee **at
  least 2** full rest days per week, not just one. Cap quality
  (threshold/interval/race-pace) work at one session per week until at
  least 2-3 logged blocks show it's being handled well. Write extra
  explicit technique/form cueing into session `notes` — a beginner needs
  more "what this should feel like" guidance than an experienced athlete
  given the same prescribed set.
- **Intermediate** — the baseline behavior assumed elsewhere in this
  document by default: ~7% weekly increase cap, at least 1 rest day per
  week, up to 2 quality sessions per week, standard periodization pacing.
  This is also the default tier when the onboarding signals are mixed or
  genuinely inconclusive.
- **Advanced** — weekly increases can run up to ~10% when the log
  supports it (§7.3 still governs — never outrun demonstrated capacity
  just because the tier allows more). Back-to-back quality days (e.g., a
  Saturday brick followed by a Sunday tempo run) are permissible if the
  week's overall structure still respects recovery. Up to 3 quality/key
  sessions per week. At least 1 full rest day per week is still a hard
  floor — Advanced does not mean zero recovery days.

**Once a meaningful training log exists (roughly 3+ logged weeks), let
demonstrated capacity (§7.3) lead over the onboarding-derived tier** — the
tier exists to give the *first* block(s) a sensible starting point when
there's no log yet to read fitness from. If the tier and the log disagree
(e.g., tier says Beginner but the log already shows the athlete handling
Intermediate-level volume comfortably), trust the log and note the
tier's effective upgrade in that block's `## Notes`.

### 7.8 Injury & ongoing condition adaptation — binding, not just contextual

The check-in prompt's athlete background section may include past injury
history and/or a currently-ongoing condition/niggle the athlete flagged
during onboarding. Treat these as binding constraints on the plan, not
background color to mention once and then ignore:

- If a **past injury** is reported (implicitly resolved, no longer
  active — the onboarding question is phrased in the past tense), bias the
  return-to-load progression more conservatively for the specific movement
  pattern or discipline involved (e.g., a past IT-band issue → ramp weekly
  run volume more gradually than §7.7's tier-based cap would otherwise
  allow, and favor gym/S&C work that supports that area).
- If an **ongoing condition** is reported, treat it as an active
  constraint for the *whole block*, not just the first week: avoid
  prescribing exercises/movements that plausibly aggravate it, and add a
  line in `## Notes` naming what was avoided/adjusted and why, plus a
  suggestion to confirm with a physio/doctor before progressing that
  specific area further. Never diagnose the condition or promise a
  training fix for it — the plan works around it, it doesn't treat it.
- When choosing between two otherwise-equal session designs and one is
  more conservative regarding a flagged injury/condition, choose the
  conservative one.

### 7.9 Lifestyle-adjusted recovery capacity

`onboardingJobType` and `onboardingSleepHours` (when supplied) bias where
in each week's volume range (§7.1) the plan should sit, independent of the
experience tier (§7.7) — the two stack, they don't override each other:

- **Physically active job**, or **reported sleep under ~6.5h/night**: bias
  toward the lower half of §7.1's volume range for that phase, and avoid
  stacking a hard training day on top of what the athlete's schedule
  suggests is a regular demanding-work day.
- **Desk job** and **adequate reported sleep (~7-9h/night)**: no bias
  needed — use the tier-appropriate default within §7.1's range.
- This is a bias on *where in the range* to land, not a hard cap the way
  §7.5's day-count limit is — it never overrides §7.7's weekly-increase
  cap or §7.5's day-count ceiling, it just nudges volume lower within
  whatever range those already allow.

### 7.10 Deterministic load cycling and no-race-date macrocycle

For **Cadence hybrid-generated plans**, phase and weekly target volume are
scheduler-owned locked fields. The AI elaborates the sessions but must not
change this progression pattern.

- Full training weeks use a **3:1 load/deload rhythm**: three loading weeks,
  then one `Recovery` week. The recovery week intentionally reduces weekly
  volume and removes quality work; it is not a failed progression week.
- Within a loading phase, Cadence uses the phase's full §7.1 volume range
  rather than a permanent midpoint. The target moves upward across the three
  loading weeks, subject to §7.7's tier-specific increase cap, demonstrated
  capacity, lifestyle bias, and structured check-in recovery/pain signals.
- A planned recovery week is calculated from the most recent completed
  **non-recovery** load week. The following loading week also resumes from the
  last non-recovery baseline, so the deload itself never becomes a lower
  progression ceiling.
- When a **competition date is set**, race proximity determines the underlying
  Build-up / Endurance / Peak / Taper macro phase. The 3:1 recovery rhythm may
  interrupt Build-up or Endurance, but never overrides Peak, Taper, or
  post-race Recovery.
- When **no competition date is set**, Cadence must not remain in Build-up
  indefinitely: full Weeks 1-3 are `Build-up`, Week 4 is `Recovery`, and from
  Week 5 onward the athlete rolls through three `Endurance` loading weeks
  followed by one `Recovery` week. `Peak` and `Taper` are reserved for plans
  with an actual upcoming competition date.
- The opening partial Week 0, when present, remains a scaled introductory
  `Build-up` stretch and does not count as a full loading week or as evidence
  for the next week's progression baseline.

### 7.11 Scheduler-owned strength frequency and deloads

Profile `strengthSessionsPerWeek` is a target of 1–4 sessions per full loading
week, defaulting to 1 for older profiles. Existing gym/bodyweight exclusion
switches take precedence: opting out of all strength schedules zero.

- 1 session: full body; 2: upper/lower; 3: upper/lower/full body;
  4: two upper/lower pairs. Calendar order may change for placement.
- Each hybrid gym session MUST echo the entire locked
  `strengthPrescription` object exactly. This includes focus, equipment,
  mode, duration (core included), work-set bounds, effort ceiling, and core
  requirement. Copy it; do not invent another prescription.
- End each gym session with a core/abs set entry marked `isCore: true`.
  Include every locked movement slot exactly once. Normal sessions use exactly
  3 sets for every retained main exercise and 3 core sets. Recovery/deload and
  taper use exactly 2 main and 2 core sets; one-set exercises are never generated.
  Adapt exercise selection for reported conditions; do not prescribe a painful exercise.
- Normal: 35 min split / 45 min full-body gym sessions (shorter bodyweight
  variants), effort <=7/10. Deload: 25 min split / 30 min full body, effort
  <=6/10. Taper: at most one 20 min full-body session, effort <=5/10, with one
  movement slot removed when needed to reduce total work rather than sets to one.
  These are conservative app defaults, not individualized clinical rules.
- `weightKg` is actual athlete evidence and begins null. The session page offers
  inline load logging. Cadence will not invent a numerical baseline. For normal
  weeks it holds an established load until two comparable controlled completions,
  then uses double progression: repetitions advance toward 10 before a small
  2.5% upper-body or 5% lower-body load increase resets the target to 8 reps.
  Missing effort/recovery evidence holds progression. Deload/taper never progress
  load and suggest about 10% less than the established load.
- Recovery phase, fatigue, a too-hard previous block, or mild pain triggers
  the deload prescription. Significant pain suppresses strength.
- No strength on long/brick days, no third daily session, no extra training
  days. No lower/full-body work the calendar day before key run/bike/brick
  work, with at least two calendar days between lower/full-body sessions.
  If sharing a quality day, endurance comes first; separate sessions where possible.
- No strength in the final six days before the race, on race day, or for
  seven days afterwards. Taper/recovery phase selection itself is unchanged.
- Partial-week targets are scaled. If a target cannot fit, Cadence recomputes
  a balanced smaller split and shows requested versus scheduled counts and
  reasons. Never restore omitted sessions in the AI response.
- Stored/backup sessions preserve strengthPrescription and sets[].isCore.
  Legacy gym sessions lacking these fields remain readable; the new contract
  is mandatory only when the locked skeleton supplies a strengthPrescription.

### 7.12 Evidence-led endurance planning (skeleton v4)

This section OVERRIDES older goal-derived pace formulas and generic weekly
volume ranges whenever Cadence supplies an endurancePrescription. Race
goals are objectives, not evidence of current fitness. Do not use the old
8–10% comparison to override the locked prescription.

- Cadence stores separate run pace (seconds/km), bike FTP (watts), and swim
  threshold/CSS (seconds/100m) records. Personal estimates remain provisional.
  A working target may approach an estimate after controlled feedback without
  changing the stored baseline. Only athlete-confirmed assessment updates
  change that baseline.
- Missing fitness information means an explicit effort-led target. Never
  invent numerical pace/power to fill it in. Cycling without confirmed power
  equipment also uses effort, not goal-speed-to-watts conversion.
- Cadence supplies separate development and race-specific workload families.
  Repetitions, work duration and recovery are numeric, not inferred from text.
  Stage progression requires comparable evidence. Baselines are frozen for
  the whole block; load weeks hold within-block allocations. Recovery rotation
  is unchanged. Recovery/taper reduces work, not the underlying fitness record.
- Output endurancePrescriptionId equal to the locked prescription's id.
  Do not duplicate the full prescription in the reply. Copy prescription.steps
  into sets in the same order, preserving stepId, stepType, durationSeconds,
  distanceM, target, duration, paceOrPower, rest and setsCount EXACTLY. Do not
  add reps or weightKg. Coaching/technique cues may elaborate exercise labels
  but must not contradict the targets. The importer validates actual steps
  and reconstructs the complete prescription from the locked snapshot.
- Swim volume is capped by discipline-specific experience, recent reported
  capacity, continuous-swim comfort, time and pool access. Never cram an old
  weekly target into fewer sessions. At least two swims means one technique
  session with a larger drill share; a single swim mixes drills/full stroke.
  Drill pace is never used as threshold evidence.
- Quality spacing/caps apply across disciplines. Brick work remains easy,
  with no inference of fresh-run threshold from off-bike performance.
- Structured workout results are optional and athlete-entered. Completion,
  actual pace/power, main-effort feel, repetitions, extended recovery and
  context are distinct from the original prescription. Personal notes are
  logging/coaching context only, never automatic numerical evidence.
- Preserve isOptional exactly. For discretionary reductions: "Skip this
  session if you feel unusually tired or heavy. Prioritize rest; there is no
  need to make it up." Hard recovery/placement constraints require omission
  or replacement, never an Optional loophole. Optional work still counts
  against the maximum planned workload.
- Timed run/bike/brick distances are explicitly estimates, not measurements.
  Do not describe them as demonstrated performance. Swim distance includes
  all prescribed distance-bearing steps. Never add hidden work.
- Import rejects changed profile/evidence snapshots. Generation itself does
  not advance state. Old plans remain readable; this contract applies only
  when the supplied skeleton contains the new prescriptions.
