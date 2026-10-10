/* Plain-English QA vocabulary and the bug-tracker lesson quiz. */
(function (QA) {
  'use strict';

  QA.GLOSSARY = [
    { term: 'Defect / bug', def: 'Behavior that differs from what the game is supposed to do, as defined by a requirement, design document, or clearly established game behavior. A difference you simply don’t like is feedback, not necessarily a defect.' },
    { term: 'Reproduction steps (repro steps)', def: 'A numbered list of actions that makes the defect happen. Good steps start from a known state and are specific enough that someone else gets the same result without asking you.' },
    { term: 'Reproducibility / frequency', def: 'How often the defect happens when you follow the steps, stated as a count: “4 out of 5 attempts.” Avoid “always” unless it really was every time, and say how many times you tried.' },
    { term: 'Expected result', def: 'What should happen, based on a spec, design document or established behavior. Cite the source when you can.' },
    { term: 'Actual result', def: 'What did happen, described as an observation. No guesses about the cause.' },
    { term: 'Severity', def: 'How bad the defect is for the player or product: crash, data loss, blocked progress, a cosmetic glitch. Usually set by QA based on evidence.' },
    { term: 'Priority', def: 'How soon the team should fix it, given schedule, release plans and business needs. Often set or adjusted by a lead or producer. A typo in the title screen can be low severity but high priority.' },
    { term: 'Build / version', def: 'A specific compiled version of the game, identified by a number like 0.9.412. Every result you record should name the build, because the same steps can behave differently in another build.' },
    { term: 'Test case', def: 'A single, repeatable check: preconditions, steps and an expected result, so anyone can run it and record pass, fail or blocked.' },
    { term: 'Test suite', def: 'A group of related test cases run together, for example “Save/Load suite” or “Multiplayer smoke test.”' },
    { term: 'Pass / Fail / Blocked', def: 'Pass: the actual result matched the expected result. Fail: it did not. Blocked: the test couldn’t be run because of something else (crash before the test point, missing hardware, missing build).' },
    { term: 'Regression testing', def: 'Re-testing after a change to make sure things that worked before still work. Fixes can break nearby features, especially ones sharing code.' },
    { term: 'Fix verification', def: 'Confirming a specific reported defect no longer happens in the build that contains the fix, by repeating the original steps.' },
    { term: 'Compatibility testing', def: 'Checking the game works across the configurations players use: hardware models, system software versions, display modes, controllers and accessories, and save data from older versions.' },
    { term: 'Smoke test', def: 'A quick, broad check that a new build is basically working (boots, loads, saves) before deeper testing.' },
    { term: 'Edge case / boundary', def: 'An input or situation at the limits of what’s allowed: 0, the maximum, one past the maximum, or an unusual timing.' },
    { term: 'Soft-lock', def: 'The game keeps running but the player can’t continue or escape (e.g. stuck on a loading screen with no working menu).' },
    { term: 'Workaround', def: 'A way for the player to avoid or recover from a defect. It often lowers severity but doesn’t make the defect acceptable.' },
    { term: 'Duplicate', def: 'A report of a defect that is already tracked. Search before filing; if you have new information, add it to the existing ticket.' },
    { term: 'Certification / compliance testing', def: 'Checking a game against a platform holder’s technical requirements before release (e.g. how it handles saving, errors, system features). Exact requirements are confidential and vary by platform.' },
  ];

  QA.TRACKER_QUIZ = [
    {
      id: 'q1',
      q: 'A typo in the game’s title on the main menu: what is the most likely combination?',
      options: [
        { id: 'a', text: 'High severity, low priority' },
        { id: 'b', text: 'Low severity, high priority', correct: true },
        { id: 'c', text: 'High severity, high priority' },
      ],
      why: 'It doesn’t affect gameplay (low severity), but everyone sees it, so teams usually want it fixed quickly (high priority).',
    },
    {
      id: 'q2',
      q: 'A crash that only happens on a hidden debug menu players can’t access. Most likely?',
      options: [
        { id: 'a', text: 'High severity, low priority', correct: true },
        { id: 'b', text: 'Low severity, high priority' },
        { id: 'c', text: 'Low severity, low priority' },
      ],
      why: 'A crash is severe, but if players can’t reach it the fix can wait.',
    },
    {
      id: 'q3',
      q: 'You retest a Resolved ticket on the fix build and the original problem still happens. What should you do?',
      options: [
        { id: 'a', text: 'Create a new ticket with the same information' },
        { id: 'b', text: 'Reopen the ticket and comment with the build, steps, results and evidence', correct: true },
        { id: 'c', text: 'Leave it Resolved and message the developer privately' },
      ],
      why: 'Reopening keeps the history in one place, and the comment gives the developer what they need.',
    },
    {
      id: 'q4',
      q: 'Which belongs in the “Actual result” field?',
      options: [
        { id: 'a', text: 'The character fell through the platform and lost a life.', correct: true },
        { id: 'b', text: 'The collision code is not updating fast enough.' },
        { id: 'c', text: 'The character should stay on the platform.' },
      ],
      why: 'Actual result is an observation. (b) is a guess about the cause; (c) is the expected result.',
    },
    {
      id: 'q5',
      q: 'Before filing a new bug, what should you do first?',
      options: [
        { id: 'a', text: 'Assign it to the developer you think wrote the code' },
        { id: 'b', text: 'Search the tracker for an existing report of the same issue', correct: true },
        { id: 'c', text: 'Set it to the highest priority so it gets noticed' },
      ],
      why: 'Duplicates waste time. If one exists, add your new information to it.',
    },
    {
      id: 'q6',
      q: 'A developer comments “Can’t reproduce, closing.” You still see it. Best response?',
      options: [
        { id: 'a', text: 'Reopen and comment with exact build, setup, a video, and your attempt counts; ask what differs in their setup', correct: true },
        { id: 'b', text: 'Leave it closed; they know the code better' },
        { id: 'c', text: 'Reopen it with the comment “It’s definitely still broken.”' },
      ],
      why: 'Stay objective and add evidence. Differences in setup are the usual reason for “can’t reproduce”.',
    },
  ];
})(window.QA);
