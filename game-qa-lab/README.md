# Game QA Lab

An interactive training simulator for people preparing for an entry-level video game QA tester role, such as a certification or compatibility tester. You practice the job by doing it: reproduce fictional defects on a simulated test bench, write bug reports, design test cases, verify fixes, and rehearse interview answers.

> Independent training tool. Not affiliated with or endorsed by Nintendo or any other game company. All games, builds, tickets and defects are fictional.

## Run it

Requires Node.js 18+ and no other dependencies.

```bash
cd game-qa-lab
npm start
```

Then open http://localhost:5173/ (pass another port with `node server.js 8080`).

You can also open `index.html` directly in a browser. The app uses plain `<script>` tags, so it works from `file://` too.

## What's inside

| Section | What you do |
| --- | --- |
| Dashboard | Real progress, skills and a recommended next activity |
| Mission Center | 3 full investigations (moving platform, missing save, multiplayer disconnect), each with a working test bench, graded decisions, a model investigation and an example report |
| Bug Report Lab | Turn messy tester notes into a structured report and get rubric feedback |
| Test Case Workshop | Write, edit and delete test cases across 7 risk areas, then check coverage |
| Regression Lab | Verify two "fixed" bugs and mark results pass / fail / blocked |
| Bug Tracker Basics | Fictional ticket anatomy, lifecycle, severity vs. priority, quiz |
| QA Glossary | Plain-English vocabulary |
| Mock Interview | 18 questions in 10 topics, rubric scoring, example answers, revise and resubmit |
| Readiness Review | A summary built only from your recorded activity, plus a checklist |

## How scoring works

All evaluation is local and rule-based (`js/evaluators.js`). No AI service or network call is involved. Each score shows the rule that produced it. Bug reports are checked for keyword coverage against the facts in the notes, structure, an exact frequency match, and speculative wording. Interview answers are scored on relevance, clarity, evidence, logical process (STAR for behavioral questions) and honesty. These scores are a training aid, not a hiring assessment.

Mission test benches are deterministic: the *n*th attempt of a given setup always produces the same result. That is how the frequency you report can be checked against your own log.

## Data and privacy

Progress is stored in `localStorage` under `game-qa-lab:v1` in your browser only. *Progress & settings* lets you download a JSON backup or reset everything.

## Project layout

```
index.html          app shell and navigation
css/styles.css      theme and layout
js/util.js          helpers
js/store.js         localStorage persistence
js/data/*.js        missions, regression scenarios, defects, workshop, interview, glossary
js/evaluators.js    report / text / interview / test-case scoring rules
js/engine.js        mission step engine and shared UI components
js/progress.js      derived dashboard metrics and recommendations
js/views/*.js       one file per section
js/app.js           hash router
server.js           zero-dependency static server
tests/e2e.js        browser end-to-end test (Playwright)
```

## Tests

With the app running (`npm start`) and Playwright available:

```bash
npm test                       # uses BASE_URL=http://localhost:5173/ by default
```

The test plays all 3 missions and both regression scenarios. It also checks validation, weak vs. strong bug reports, interview revision, test case add/edit/delete, the dashboard, persistence across reloads, the mobile layout and reset.
