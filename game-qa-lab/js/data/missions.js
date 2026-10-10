/* Training missions. All games, builds and defects are fictional.
   Each mission is a sequence of steps interpreted by js/engine.js. */
(function (QA) {
  'use strict';

  QA.SCALES = {
    severity: [
      { id: 'S1', label: 'S1 · Critical', desc: 'Crash, hang or soft-lock with no in-game recovery, corruption of existing save data, or progression blocked with no workaround.' },
      { id: 'S2', label: 'S2 · Major', desc: 'A core feature misbehaves or the player loses progress/resources, but the game keeps running or a workaround exists.' },
      { id: 'S3', label: 'S3 · Minor', desc: 'Noticeable problem with limited player impact; easy to avoid or recover from.' },
      { id: 'S4', label: 'S4 · Trivial', desc: 'Cosmetic or polish issue (typo, small visual glitch) with no effect on play.' },
    ],
    priority: [
      { id: 'P1', label: 'P1 · Immediate', desc: 'Fix now; blocks testing, a milestone, or release.' },
      { id: 'P2', label: 'P2 · High', desc: 'Must be fixed before release; schedule soon.' },
      { id: 'P3', label: 'P3 · Medium', desc: 'Should be fixed if time allows before release.' },
      { id: 'P4', label: 'P4 · Low', desc: 'Fix when convenient, or may be deferred.' },
    ],
  };

  /* Deterministic "intermittent" behaviour: the nth attempt of a setup uses pattern[n % len].
     Same inputs always give the same log, so stated frequencies can be checked exactly. */
  const at = (pattern, n) => !!pattern[n % pattern.length];

  /* ---------------------------------------------------------------------------------------- */
  const m1 = {
    id: 'm1',
    kind: 'mission',
    title: 'The Moving Platform',
    game: 'Pebble & Pip: Skyward Isles',
    tagline: 'A character sometimes falls straight through a moving platform. Find out when, how often, and write it up.',
    skills: ['repro', 'facts', 'severity', 'reporting'],
    minutes: 15,
    briefing: `
      <p class="brief">Bug intake from a playtest session: <em>“Fell through one of the moving platforms in Cogwork Canyon. Happened a couple of times. Pretty sure the collision is broken on all the moving stuff.”</em></p>
      <p>Your lead asks you to investigate. Confirm whether the issue reproduces, find the conditions that trigger it, measure how often it happens, and file a defect report another tester could follow without asking you questions.</p>`,
    spec: [
      ['Build', '0.9.412 (dev kit, TV display mode)'],
      ['Level', '3-2 “Cogwork Canyon”, checkpoint B. The gear platform after checkpoint B is on the only path forward.'],
      ['LVL-3-2-04', 'Moving platforms carry the player. A player who lands on the top surface stays on it until they jump or walk off.'],
    ],
    steps: [
      {
        id: 'gather', type: 'multi', skill: 'repro',
        title: 'Gather context before testing',
        prompt: 'Before you touch the controller, which of these should you collect or confirm? Select all that apply.',
        options: [
          { id: 'build', text: 'The exact build number the playtester was using.', correct: true, why: 'Bugs are tied to builds. Without it nobody knows whether a later build already changed the behavior.' },
          { id: 'where', text: 'The exact level, checkpoint and which platform it was.', correct: true, why: 'A precise location lets you (and later a developer) go straight to the problem.' },
          { id: 'hw', text: 'Hardware and display mode used during the playtest.', correct: true, why: 'Environment differences (hardware, display mode, performance) can change behavior.' },
          { id: 'action', text: 'What the player was doing just before falling (jumping, running, landing).', correct: true, why: 'The preceding action is often the trigger. It gives you a first variable to test.' },
          { id: 'cause', text: 'Decide what the root cause is first, so you know what to test.', correct: false, why: 'Testers observe and narrow conditions; diagnosing code is the developer’s job. Deciding a cause early biases what you test.' },
          { id: 'dev', text: 'The name of the programmer who wrote the collision code.', correct: false, why: 'Not needed to reproduce or report. Assignment is handled through the tracker and your lead.' },
          { id: 'mood', text: 'Whether the playtester enjoyed the level.', correct: false, why: 'Useful for design feedback, but it does not help reproduce this defect.' },
        ],
      },
      {
        id: 'bench', type: 'bench', skill: 'repro',
        title: 'Reproduce it on the test bench',
        prompt: 'Choose a setup and run attempts. Every attempt is recorded in your test log. Vary one thing at a time and repeat setups enough to trust the result.',
        minRuns: 5,
        variables: [
          { id: 'motion', label: 'Platform movement when you land', options: [{ id: 'horizontal', label: 'Moving sideways' }, { id: 'rising', label: 'Rising' }, { id: 'descending', label: 'Descending' }] },
          { id: 'jump', label: 'Jump type', options: [{ id: 'hop', label: 'Short hop' }, { id: 'full', label: 'Full jump' }] },
          { id: 'landing', label: 'Landing spot', options: [{ id: 'center', label: 'Center' }, { id: 'edge', label: 'Near edge' }] },
        ],
        outcome(c, n) {
          const fail = c.motion === 'descending' && c.jump === 'full' && at([1, 1, 0, 1, 1], n);
          return fail
            ? { fail: true, summary: 'Fell through platform', obs: [['Character', 'Touched the platform top, then dropped through it about 0.2 s later.'], ['Platform', 'Kept moving normally.'], ['Result', 'Lost 1 life, respawned at checkpoint B.']] }
            : { fail: false, summary: 'Rode platform normally', obs: [['Character', 'Landed and stayed on the platform.'], ['Platform', 'Carried the character as expected.'], ['Result', 'No life lost.']] };
        },
        isTarget: (c) => c.motion === 'descending' && c.jump === 'full',
        goals: [
          { label: 'Explored at least 4 different setups', test: (log, h) => h.distinct(log) >= 4, why: 'Trying several setups shows which variables matter instead of assuming.' },
          { label: 'Reproduced the fall-through at least once', test: (log) => log.some((r) => r.fail), why: 'You cannot describe a defect accurately until you have seen it yourself.' },
          { label: 'Repeated a failing setup at least 5 times', test: (log, h) => h.maxFailingRuns(log) >= 5, why: 'An intermittent bug needs repeated attempts to give a trustworthy frequency.' },
          { label: 'Isolated a variable: ran a passing setup that differs from a failing one by exactly one setting', test: (log, h) => h.isolated(log), why: 'Changing one variable at a time is how you prove which condition actually matters.' },
        ],
      },
      {
        id: 'conditions', type: 'multi', skill: 'repro',
        title: 'Identify the reproduction conditions',
        prompt: 'Using only your test log, which conditions are needed to reproduce the fall-through? Select all that apply.',
        options: [
          { id: 'desc', text: 'The platform is descending when the character lands.', correct: true, why: 'Failures only occurred on a descending platform.' },
          { id: 'full', text: 'The character lands from a full jump.', correct: true, why: 'Short hops onto a descending platform never fell through. The extra fall speed of a full jump matters.' },
          { id: 'edge', text: 'The character lands near the edge.', correct: false, why: 'Landing spot made no difference: center and edge landings failed at the same rate.' },
          { id: 'side', text: 'The platform is moving sideways.', correct: false, why: 'Sideways platforms never failed.' },
          { id: 'rise', text: 'The platform is rising.', correct: false, why: 'Rising platforms never failed.' },
        ],
      },
      {
        id: 'freq', type: 'frequency', skill: 'repro', bench: 'bench', minAttempts: 5,
        title: 'State the reproduction frequency',
        prompt: 'Pick the setup that reproduces the defect and state how many attempts failed out of how many you ran. It must match your own log.',
      },
      {
        id: 'facts', type: 'classify', skill: 'facts',
        title: 'Separate observations from assumptions',
        prompt: 'A teammate, Dana, left these notes on the issue. Classify each statement.',
        categories: ['Observed fact', 'Assumption'],
        items: [
          { id: 'a', text: 'On build 0.9.412, the character fell through the descending gear platform after a full jump.', answer: 'Observed fact', why: 'Directly observed and tied to a build.' },
          { id: 'b', text: 'The collision code doesn’t update when the platform moves down.', answer: 'Assumption', why: 'A guess about the cause. Nobody on QA observed the code; leave diagnosis to developers or label it as a hypothesis.' },
          { id: 'c', text: 'Every moving platform in the game has this problem.', answer: 'Assumption', why: 'Only platforms in 3-2 were tested. Generalizing beyond what was tested is an assumption.' },
          { id: 'd', text: 'Falling through cost one life and respawned the player at checkpoint B.', answer: 'Observed fact', why: 'A concrete, observed consequence.' },
          { id: 'e', text: 'It is probably caused by frame-rate drops.', answer: 'Assumption', why: '“Probably” signals a guess. No frame-rate data was collected.' },
          { id: 'f', text: 'Short hops onto the descending platform did not fall through in 10 attempts.', answer: 'Observed fact', why: 'A measured, negative result. These are valuable because they narrow the conditions.' },
        ],
      },
      {
        id: 'severity', type: 'single', skill: 'severity', weight: 2, showScale: 'severity',
        title: 'Choose a severity',
        prompt: 'The platform is on the only path forward. Falling costs a life, and the player can retry. Short hops avoid the problem. Which severity fits best?',
        options: [
          { id: 'S1', text: 'S1 · Critical', points: 0.25, why: 'Not critical: no crash, hang or data loss, and players can still progress (retry, or short-hop).' },
          { id: 'S2', text: 'S2 · Major', points: 1, why: 'Core movement on the required path fails most of the time and costs lives. A workaround exists, so it is serious but not critical.' },
          { id: 'S3', text: 'S3 · Minor', points: 0.5, why: 'Understates it: it happens in most full-jump attempts on a required path and costs lives. Most players won’t know the workaround.' },
          { id: 'S4', text: 'S4 · Trivial', points: 0, why: 'This affects gameplay, not just appearance.' },
        ],
      },
      {
        id: 'impact', type: 'text', skill: 'severity', minWords: 15,
        title: 'Explain the impact',
        prompt: 'In 2–4 sentences, justify your severity using evidence: who is affected, what it costs the player, how often, and whether there is a workaround.',
        placeholder: 'e.g. The gear platform is on the only path through 3-2…',
        groups: [
          { label: 'Describes the cost to the player (lives, checkpoint, progress)', any: ['life', 'lives', 'checkpoint', 'respawn', 'progress', 'die', 'death'] },
          { label: 'Uses the measured frequency', any: [/\d+\s*(\/|of|out of)\s*\d+/, '%', 'most attempts', 'frequen'] },
          { label: 'Mentions whether a workaround exists', any: ['workaround', 'short hop', 'hop', 'retry', 'avoid', 'still progress', 'still possible'] },
          { label: 'Notes that it is on the required path', any: ['only path', 'required', 'critical path', 'must cross', 'forward', 'progress through', '3-2', 'cogwork'] },
        ],
        penalties: [
          { label: 'Contains a guess about the cause (“probably”, “I think”, code). Keep impact statements to evidence.', any: ['probably', 'i think', 'i guess', 'the code', 'collision code', 'must be caused'] },
        ],
      },
      {
        id: 'report', type: 'report', skill: 'reporting', weight: 10, bench: 'bench',
        title: 'Write the defect report',
        prompt: 'Write the core of the report. Someone who has never seen this issue should be able to reproduce it from your text alone.',
        fields: ['title', 'pre', 'steps', 'expected', 'actual', 'frequency'],
        defectRef: 'm1-platform',
      },
    ],
    modelInvestigation: `
      <ol>
        <li>Confirmed the build (0.9.412), hardware/display mode, level 3-2 and the platform after checkpoint B.</li>
        <li>Ran the obvious setup first (full jump onto the platform), then changed <strong>one variable at a time</strong>: direction of movement, jump type, landing spot.</li>
        <li>Found failures only on a <strong>descending</strong> platform after a <strong>full jump</strong>. Center and edge landings failed equally, so landing spot was ruled out.</li>
        <li>Repeated the failing setup until the rate was stable: <strong>4 out of 5 attempts</strong>. Ran short-hop and rising/sideways setups as controls: 0 failures.</li>
        <li>Kept the playtester’s claim (“all moving stuff is broken”) out of the report because it was not verified. Platforms in other levels were noted as untested.</li>
        <li>Rated S2 Major: required path, frequent, costs lives, but recoverable and avoidable with a short hop.</li>
      </ol>`,
  };

  /* ---------------------------------------------------------------------------------------- */
  const m2 = {
    id: 'm2',
    kind: 'mission',
    title: 'The Missing Save',
    game: 'Lantern Lane',
    tagline: 'Completed levels sometimes come back incomplete after the player exits. Pin down which exits lose data, and whether the spec allows it.',
    skills: ['testdesign', 'repro', 'facts', 'severity', 'reporting'],
    minutes: 18,
    briefing: `
      <p class="brief">Player support ticket: <em>“I beat the Clocktower level, quit the game, and when I came back it said I hadn’t finished it. Saves are broken if you exit fast.”</em></p>
      <p>Investigate save and load behavior around level completion. Not every lost save is a defect. Compare what you observe with the save requirements below, and only report what you can reproduce.</p>`,
    spec: [
      ['Build', '1.2.087 (dev kit). Level 4-3 “Clocktower”.'],
      ['SAV-01', 'Progress is saved automatically when a level is completed. After the level ends, a 2-second results screen is shown.'],
      ['SAV-02', 'A save icon is displayed while data is written. The game shows: “Do not turn off the power while this icon is displayed.”'],
      ['SAV-03', 'Closing the software from the system menu, or returning to the title screen, must not lose progress completed before the exit.'],
    ],
    steps: [
      {
        id: 'plan', type: 'multi', skill: 'testdesign',
        title: 'Plan your save/load test cases',
        prompt: 'Which test cases belong in your plan for this investigation? Select all that apply.',
        options: [
          { id: 'baseline', text: 'Complete 4-3, wait until the save icon disappears, close the software, relaunch, check progress.', correct: true, why: 'A baseline/control: proves saving works in the normal case so failures elsewhere mean something.' },
          { id: 'results', text: 'Close the software during the results screen, before the save icon appears.', correct: true, why: 'Covers the earliest exit timing, the “exit fast” case from the ticket.' },
          { id: 'icon', text: 'Close the software while the save icon is displayed.', correct: true, why: 'A different exit timing. The spec says closing must not lose progress.' },
          { id: 'title', text: 'Return to the title screen during the results screen.', correct: true, why: 'A different exit method at the risky timing.' },
          { id: 'power', text: 'Power off during the save icon, then check the game still loads and older progress survives.', correct: true, why: 'Recovery behavior: even when loss is expected, the existing save must not be corrupted.' },
          { id: 'only', text: 'Only test the exact exit the player described, since that is where the bug is.', correct: false, why: 'Support tickets are vague. Covering several timings and methods tells you the real boundaries of the problem.' },
          { id: 'tv', text: 'Change TV brightness before completing the level.', correct: false, why: 'No plausible link to saving. Spend test time where it can change the outcome.' },
        ],
      },
      {
        id: 'bench', type: 'bench', skill: 'repro',
        title: 'Run your exit tests',
        prompt: 'Each attempt: complete level 4-3, exit at the chosen moment using the chosen method, relaunch, and check the level’s status.',
        minRuns: 6,
        variables: [
          { id: 'timing', label: 'When you exit', options: [{ id: 'results', label: 'Results screen (before icon)' }, { id: 'icon', label: 'While save icon shows' }, { id: 'after', label: 'After icon disappears' }] },
          { id: 'method', label: 'How you exit', options: [{ id: 'title', label: 'Return to title' }, { id: 'close', label: 'Close software' }, { id: 'power', label: 'Power off' }] },
        ],
        outcome(c, n) {
          let lost = false;
          let note = '';
          if (c.timing === 'results' && c.method !== 'title') { lost = at([1, 1, 0, 1], n); note = 'Save icon had not appeared yet.'; }
          else if (c.timing === 'icon' && c.method === 'power') { lost = at([1, 0, 1, 1], n); note = 'Save icon and power-off warning were on screen.'; }
          else if (c.method === 'title') note = 'Game waited for the save to finish before showing the title.';
          const obs = [
            ['Level 4-3', lost ? 'Shown as NOT complete' : 'Shown as complete'],
            ['Save file', 'Loads normally. Levels 1-1 to 4-2 intact.'],
          ];
          if (note) obs.push(['Note', note]);
          return { fail: lost, summary: lost ? 'Progress lost' : 'Progress kept', obs };
        },
        isTarget: (c) => c.timing === 'results' && c.method !== 'title',
        goals: [
          { label: 'Tested all three exit timings', test: (log, h) => h.valuesTried(log, 'timing') >= 3, why: 'Timing is the variable the player hinted at. Cover it fully.' },
          { label: 'Tested at least two exit methods', test: (log, h) => h.valuesTried(log, 'method') >= 2, why: 'Different exit paths take different code paths.' },
          { label: 'Reproduced progress loss before the save icon appeared', test: (log) => log.some((r) => r.fail && r.config.timing === 'results'), why: 'This is the case the spec does not allow.' },
          { label: 'Repeated a losing setup at least 4 times', test: (log, h) => h.maxFailingRuns(log) >= 4, why: 'Needed for an honest frequency.' },
          { label: 'Ran a control that kept progress', test: (log) => log.some((r) => !r.fail && r.config.timing === 'after'), why: 'Shows saving works normally, which isolates the timing as the trigger.' },
        ],
      },
      {
        id: 'judge', type: 'classify', skill: 'facts',
        title: 'Defect, expected, or unverified?',
        prompt: 'For each result or claim, decide whether it is a defect against the spec, expected/documented behavior, or not verified yet.',
        categories: ['Defect (violates spec)', 'Expected behavior', 'Not verified'],
        items: [
          { id: 'a', text: 'Closing the software during the results screen lost level 4-3 progress.', answer: 'Defect (violates spec)', why: 'SAV-03 says closing must not lose completed progress. No warning was on screen.' },
          { id: 'b', text: 'Powering off while the save icon was displayed lost level 4-3 progress.', answer: 'Expected behavior', why: 'SAV-02 documents this risk and warns the player. Still record that the save file recovered.' },
          { id: 'c', text: 'After a power-off during the icon, the save loaded and earlier levels were intact.', answer: 'Expected behavior', why: 'Correct recovery: the existing save was not corrupted.' },
          { id: 'd', text: 'The player says this also happens on the older 1.1 build.', answer: 'Not verified', why: 'Possibly true, but you have not tested 1.1. Note it as unverified, or test it if it matters.' },
          { id: 'e', text: 'A forum post claims quitting fast can corrupt the whole save file.', answer: 'Not verified', why: 'You never saw corruption. Treat it as a lead to test, not a fact to report.' },
          { id: 'f', text: 'Returning to title during the results screen kept progress.', answer: 'Expected behavior', why: 'Matches SAV-03. Useful as a contrast in your report.' },
        ],
      },
      {
        id: 'freq', type: 'frequency', skill: 'repro', bench: 'bench', minAttempts: 4,
        title: 'State the reproduction frequency',
        prompt: 'Pick the setup that shows the defect (not the documented behavior) and state failures out of attempts from your log.',
      },
      {
        id: 'claim', type: 'single', skill: 'facts', weight: 2,
        title: 'Handle the reporter’s claim',
        prompt: 'The ticket says “saves are broken if you exit fast.” How should your report describe the problem?',
        options: [
          { id: 'precise', text: 'Report only what you reproduced: closing or powering off during the results screen loses that level’s progress in 3 of 4 attempts. Note that returning to title and exits after the icon kept progress.', points: 1, why: 'Specific, measured and bounded. It also tells developers which paths are safe.' },
          { id: 'broad', text: 'Report “Save system broken when exiting quickly” and rate it Critical, because data loss is serious.', points: 0.25, why: 'Too broad, and it overstates severity. Not all quick exits lose data, and existing saves are never corrupted.' },
          { id: 'wait', text: 'Don’t report until it reproduces 100% of the time.', points: 0, why: 'Intermittent defects are reported with their measured frequency. Waiting hides real risk.' },
          { id: 'verbatim', text: 'Copy the player’s description, since they experienced it first-hand.', points: 0, why: 'The player’s report is the starting point, not the result. Your job is to turn it into verified facts.' },
        ],
      },
      {
        id: 'priority', type: 'single', skill: 'severity', weight: 2, showScale: 'priority',
        title: 'Recommend a priority',
        prompt: 'Release is in 3 weeks. Any player who closes the game within ~2 seconds of finishing a level loses that level (5–10 minutes to replay). Older progress is never affected. Which priority would you recommend?',
        options: [
          { id: 'P1', text: 'P1 · Immediate', points: 0.4, why: 'It doesn’t block testing or other work, and existing saves are safe. Urgent, but not stop-everything.' },
          { id: 'P2', text: 'P2 · High', points: 1, why: 'Players will hit this naturally and lose progress. It should be fixed before release, though it doesn’t block current testing.' },
          { id: 'P3', text: 'P3 · Medium', points: 0.4, why: 'Understates it: losing completed progress is very visible to players and generates support tickets.' },
          { id: 'P4', text: 'P4 · Low', points: 0, why: 'Shipping a spec violation that loses progress would be a poor outcome.' },
        ],
      },
      {
        id: 'report', type: 'report', skill: 'reporting', weight: 10, bench: 'bench',
        title: 'Write the defect report',
        prompt: 'Report the defect you verified. Include the environment and a severity that matches the evidence.',
        fields: ['title', 'env', 'steps', 'expected', 'actual', 'frequency', 'severity'],
        defectRef: 'm2-save',
      },
    ],
    modelInvestigation: `
      <ol>
        <li>Read the save requirements first, so “expected” was grounded in SAV-01 to SAV-03 and not in opinion.</li>
        <li>Planned a matrix: 3 exit timings × 3 exit methods, plus a baseline (exit after the icon disappears).</li>
        <li>Found progress lost when <strong>closing or powering off during the results screen</strong> (before the save icon appears): 3 of 4 attempts each. Returning to title at the same moment never lost progress, which suggests the title path waits for the save.</li>
        <li>Power-off <em>during</em> the icon also lost progress, but the spec warns about that. Recorded it as expected, and confirmed the save file still loaded with earlier levels intact.</li>
        <li>Did not report the claims about build 1.1 or corruption, because neither was verified. Listed them as possible follow-up tests.</li>
        <li>Severity S2 (only the just-completed level is lost; existing data safe), recommended priority P2.</li>
      </ol>`,
  };

  /* ---------------------------------------------------------------------------------------- */
  const m3 = {
    id: 'm3',
    kind: 'mission',
    title: 'The Multiplayer Disconnect',
    game: 'Turbo Tumble Arena',
    tagline: 'One player drops between rounds and the other may get stuck. Test the match lifecycle and write steps anyone can repeat.',
    skills: ['multiplayer', 'testdesign', 'facts', 'severity', 'reporting'],
    minutes: 20,
    briefing: `
      <p class="brief">From the overnight multiplayer session: <em>“Guest dropped right as round 2 was loading. Host screen sat there forever. Had to close the game.”</em></p>
      <p>Set up two dev kits (Host and Guest) on the test network. Test disconnects and reconnects at different points in the match lifecycle, check player, session and match state each time, and compare against the multiplayer requirements.</p>`,
    spec: [
      ['Build', '2.0.033 on two dev kits, local test network. Online 2-player match, 3 rounds.'],
      ['MP-01', 'If a guest disconnects, the host sees “A player has left” within 15 s. In the lobby, between rounds, or on results, the host returns to the lobby. Mid-round, the host continues against a CPU.'],
      ['MP-02', 'If the host disconnects, guests return to the main menu with “The host has left the session.” (No host migration.)'],
      ['MP-03', 'A guest who reconnects within 30 s rejoins the same session with their score intact.'],
    ],
    steps: [
      {
        id: 'lifecycle', type: 'multi', skill: 'multiplayer',
        title: 'Cover the match lifecycle',
        prompt: 'At which points in the match lifecycle should you test a disconnect? Select all that apply.',
        options: [
          { id: 'lobby', text: 'In the lobby, before the match starts.', correct: true, why: 'Session exists but no match state yet. A different code path.' },
          { id: 'transition', text: 'During the loading transition between rounds.', correct: true, why: 'Where the report points. Transitions are classic trouble spots because state is changing.' },
          { id: 'mid', text: 'Mid-round, during gameplay.', correct: true, why: 'The most common real-world case and covered by MP-01.' },
          { id: 'results', text: 'On the final results screen.', correct: true, why: 'The match is ending. Check the session tears down or returns cleanly.' },
          { id: 'onlymid', text: 'Only mid-round, because that is where players spend most time.', correct: false, why: 'Ignores the reported transition and the other states.' },
          { id: 'onlytrans', text: 'Only the transition, because that is what the report says.', correct: false, why: 'Confirms the report but tells you nothing about the boundaries of the problem.' },
        ],
      },
      {
        id: 'state', type: 'multi', skill: 'multiplayer',
        title: 'Decide what to observe',
        prompt: 'On each attempt, what should you check and record? Select all that apply.',
        options: [
          { id: 'remain', text: 'The remaining player’s screen and whether their controls still respond.', correct: true, why: 'This is how you detect a soft-lock.' },
          { id: 'session', text: 'Session state: which players the session lists, whether it is still open.', correct: true, why: 'Shows whether the game noticed the disconnect.' },
          { id: 'match', text: 'Match state: current round, scores, whether the next round starts.', correct: true, why: 'Catches data issues like lost scores.' },
          { id: 'dropped', text: 'What the disconnected player sees, including any error message.', correct: true, why: 'Both sides of the connection must behave correctly.' },
          { id: 'time', text: 'How long you waited before concluding the game was stuck.', correct: true, why: '“Stuck” needs a number. The spec allows 15 s, so waiting 3 minutes is strong evidence.' },
          { id: 'fps', text: 'The menu frame rate on the dropped kit.', correct: false, why: 'Not related to the behavior under test.' },
        ],
      },
      {
        id: 'bench', type: 'bench', skill: 'multiplayer',
        title: 'Run disconnect scenarios',
        prompt: 'Pick who disconnects, when, and whether they reconnect. Each attempt reports what both kits show.',
        minRuns: 6,
        variables: [
          { id: 'who', label: 'Who disconnects', options: [{ id: 'guest', label: 'Guest' }, { id: 'host', label: 'Host' }] },
          { id: 'when', label: 'When', options: [{ id: 'lobby', label: 'Lobby' }, { id: 'transition', label: 'Round transition' }, { id: 'mid', label: 'Mid-round' }, { id: 'results', label: 'Results' }] },
          { id: 'reconnect', label: 'Reconnect', options: [{ id: 'none', label: 'No' }, { id: 'quick', label: 'Within 10 s' }] },
        ],
        outcome(c, n) {
          if (c.who === 'host') {
            return { fail: false, summary: 'Guest returned to menu (per MP-02)', obs: [['Guest screen', 'Main menu: “The host has left the session.”'], ['Host screen', c.reconnect === 'quick' ? 'Relaunched; a new empty session was created.' : 'Disconnected.'], ['Session', 'Closed.'], ['Match', 'Ended.']] };
          }
          if (c.when === 'transition' && c.reconnect === 'none') {
            return { fail: true, summary: 'Host stuck on loading', obs: [['Host screen', '“Waiting for players…” for 3 min (stopped waiting). Pause menu does not open.'], ['Guest screen', 'Disconnected (network error).'], ['Session', 'Still open, lists 1 player.'], ['Match', 'Round 2 never starts. Only way out: close the software.']] };
          }
          if (c.when === 'transition' && c.reconnect === 'quick') {
            const bad = at([1, 0, 1, 1], n);
            return { fail: bad, summary: bad ? 'Rejoined, score reset' : 'Rejoined, score intact', obs: [['Host screen', 'Showed “A player has left”, then “Player rejoined”. Round 2 started.'], ['Guest screen', 'Rejoined round 2.'], ['Session', '2 players.'], ['Match', bad ? 'Guest score shows 0. It was 1,200 after round 1.' : 'Guest score 1,200, intact.']] };
          }
          const where = { lobby: 'Stayed in the lobby', mid: 'Continued vs. CPU', results: 'Returned to lobby' }[c.when];
          return { fail: false, summary: c.reconnect === 'quick' ? 'Rejoined correctly' : 'Recovered per MP-01', obs: [['Host screen', `“A player has left” after ~3 s. ${where}.`], ['Guest screen', c.reconnect === 'quick' ? 'Rejoined; score intact.' : 'Disconnected (network error).'], ['Session', c.reconnect === 'quick' ? '2 players.' : '1 player.'], ['Match', 'State consistent.']] };
        },
        isTarget: (c) => c.who === 'guest' && c.when === 'transition' && c.reconnect === 'none',
        goals: [
          { label: 'Covered at least 3 lifecycle points', test: (log, h) => h.valuesTried(log, 'when') >= 3, why: 'Defects in transitions often hide next to working states.' },
          { label: 'Tested both host and guest disconnects', test: (log, h) => h.valuesTried(log, 'who') >= 2, why: 'Host and guest follow different rules (MP-01 vs. MP-02).' },
          { label: 'Reproduced the stuck host', test: (log) => log.some((r) => r.fail && r.config.reconnect === 'none'), why: 'The reported issue.' },
          { label: 'Tested a reconnect during the transition', test: (log) => log.some((r) => r.config.when === 'transition' && r.config.reconnect === 'quick'), why: 'Reconnects exercise MP-03 and found a second problem (score reset).' },
          { label: 'Repeated the failing setup at least 3 times', test: (log, h) => h.maxFailingRuns(log) >= 3, why: 'Confirms the stuck state is consistent.' },
        ],
      },
      {
        id: 'expected', type: 'classify', skill: 'multiplayer',
        title: 'Expected versus actual',
        prompt: 'Compare each observed behavior to the requirements.',
        categories: ['Matches spec', 'Does not match spec'],
        items: [
          { id: 'a', text: 'Host disconnects mid-round; guest returns to main menu with “The host has left the session.”', answer: 'Matches spec', why: 'MP-02. Losing the match feels bad, but it is the documented behavior, not a defect.' },
          { id: 'b', text: 'Guest disconnects during the round transition; host shows “Waiting for players…” for 3+ minutes.', answer: 'Does not match spec', why: 'MP-01 requires a message within 15 s and a return to the lobby.' },
          { id: 'c', text: 'Guest reconnects within 10 s during the transition; their round-1 score shows 0.', answer: 'Does not match spec', why: 'MP-03 requires the score to be intact.' },
          { id: 'd', text: 'Guest disconnects mid-round; host continues against a CPU.', answer: 'Matches spec', why: 'Exactly MP-01.' },
          { id: 'e', text: 'Host relaunches after disconnecting; the old session is not restored.', answer: 'Matches spec', why: 'MP-02 says no host migration. Expected, even if a player might wish otherwise.' },
        ],
      },
      {
        id: 'steps', type: 'text', skill: 'reporting', minWords: 35, minLines: 4,
        title: 'Write repeatable steps',
        prompt: 'Write numbered steps (one per line) for the stuck-host defect so another tester could reproduce it without asking you anything.',
        placeholder: '1. On Kit A (Host)…\n2. …',
        groups: [
          { label: 'Sets up two kits/players and names their roles', any: ['two', '2 kits', 'kit a', 'kit b', 'second', 'host and guest'] },
          { label: 'Creates a session and has the guest join', any: ['join', 'create', 'host a', 'lobby', 'session'] },
          { label: 'Gets to the round transition (finish round 1 / loading)', any: ['round 1', 'transition', 'loading', 'round 2', 'between rounds'] },
          { label: 'Says exactly how to disconnect the guest', any: ['unplug', 'cable', 'network', 'wi-fi', 'wifi', 'airplane', 'disable', 'lan', 'internet'] },
          { label: 'Says what to observe on the host and for how long', any: ['host screen', 'waiting for players', 'observe', 'wait', 'seconds', 'minutes', ' s ', 'sec'] },
        ],
        penalties: [
          { label: 'Vague wording (“somehow”, “etc.”, “mess with”, “some point”) makes steps unrepeatable.', any: ['somehow', 'etc', 'mess with', 'some point', 'whatever', 'stuff'] },
        ],
      },
      {
        id: 'severity', type: 'single', skill: 'severity', weight: 2, showScale: 'severity',
        title: 'Choose a severity',
        prompt: 'The host is stuck with no in-game way out and must close the software, every time a guest drops during the transition. Which severity fits?',
        options: [
          { id: 'S1', text: 'S1 · Critical', points: 1, why: 'A soft-lock with no in-game recovery that reproduces 100% under a realistic condition (an unstable connection).' },
          { id: 'S2', text: 'S2 · Major', points: 0.5, why: 'Reasonable people might argue this, but a soft-lock that forces closing the software usually counts as critical.' },
          { id: 'S3', text: 'S3 · Minor', points: 0, why: 'The player is fully stuck. That is not minor.' },
          { id: 'S4', text: 'S4 · Trivial', points: 0, why: 'This is functional, not cosmetic.' },
        ],
      },
      {
        id: 'report', type: 'report', skill: 'reporting', weight: 10, bench: 'bench',
        title: 'Complete the defect report',
        prompt: 'Write the summary, expected and actual results, and frequency for the stuck-host defect. (Your steps from earlier count separately.)',
        fields: ['title', 'expected', 'actual', 'frequency'],
        defectRef: 'm3-mp',
      },
    ],
    modelInvestigation: `
      <ol>
        <li>Read MP-01 to MP-03 so each result could be judged against a requirement.</li>
        <li>Covered the lifecycle (lobby, transition, mid-round, results) for both host and guest disconnects, with and without a quick reconnect.</li>
        <li>For each attempt, recorded both screens, the session’s player list, the round and scores, and how long you waited.</li>
        <li>Guest disconnect during the transition with no reconnect: host stuck on “Waiting for players…” for 3+ minutes, every attempt (4/4). Pause menu dead. Only exit: close the software.</li>
        <li>Found a second, separate issue: a quick reconnect during the transition reset the guest’s score in 3 of 4 attempts (MP-03). This gets <strong>its own report</strong>.</li>
        <li>Host-disconnect results matched MP-02 and were not reported as bugs.</li>
      </ol>`,
  };

  QA.MISSIONS = [m1, m2, m3];
})(window.QA);
