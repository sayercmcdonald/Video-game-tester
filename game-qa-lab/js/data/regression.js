/* Regression / fix-verification scenarios. Same step format as missions. */
(function (QA) {
  'use strict';

  const r1 = {
    id: 'r1',
    kind: 'regression',
    title: 'Verify the platform fix',
    game: 'Pebble & Pip: Skyward Isles',
    tagline: 'A developer says the moving-platform fall-through is fixed. Prove it, and check what the fix might have broken.',
    skills: ['regression', 'tracker'],
    minutes: 10,
    briefing: `
      <p class="brief">Ticket <span class="mono">PIP-2214</span>, “Character falls through descending gear platform after full jump (3-2)”, has moved to <strong>Resolved</strong>.<br>
      Developer comment: <em>“Fixed in 0.9.430. Platform collision now updates before the player landing check.”</em></p>
      <p>The ticket is assigned back to you for verification. A fix that passes one test does not prove the feature works. The change touched shared collision code.</p>`,
    spec: [
      ['Original repro', 'Build 0.9.412, level 3-2, checkpoint B: full jump onto the descending gear platform. Failed 4 out of 5 attempts.'],
      ['Fix build', '0.9.430'],
      ['Changed code', 'Shared moving-platform collision (used in worlds 2, 3 and 5).'],
    ],
    steps: [
      {
        id: 'verify', type: 'multi', skill: 'regression',
        title: 'Verify the original defect',
        prompt: 'What do you need to do to verify the original issue is fixed? Select all that apply.',
        options: [
          { id: 'build', text: 'Confirm you are actually running build 0.9.430 or later.', correct: true, why: 'Verifying on the wrong build is a classic mistake that produces false passes.' },
          { id: 'steps', text: 'Repeat the original reproduction steps exactly.', correct: true, why: 'The fix must be checked against the same conditions that failed.' },
          { id: 'count', text: 'Run at least as many attempts as the original repro (5+), ideally more.', correct: true, why: 'It failed 4/5 before. One passing attempt proves little for an intermittent bug.' },
          { id: 'once', text: 'Try it once; if it works, close the ticket.', correct: false, why: 'Intermittent defects can pass a single attempt by chance.' },
          { id: 'old', text: 'Re-test on 0.9.412 to confirm the fix.', correct: false, why: 'The old build doesn’t contain the fix. Only useful to re-confirm the original failure, not to verify.' },
        ],
      },
      {
        id: 'related', type: 'multi', skill: 'regression',
        title: 'Choose related areas to regression-test',
        prompt: 'The fix changed shared collision code. Which related areas should you check? Select all that apply.',
        options: [
          { id: 'otherdir', text: 'Sideways and rising platforms in the same level.', correct: true, why: 'Same code, different movement. Most likely to be affected.' },
          { id: 'otherlevels', text: 'Moving platforms in worlds 2 and 5, which use the same collision code.', correct: true, why: 'Shared code means shared risk.' },
          { id: 'static', text: 'Landing on stationary platforms.', correct: true, why: 'The landing check itself changed. Basic landings must still work.' },
          { id: 'ledge', text: 'Ledge-grabbing and walking off moving platforms.', correct: true, why: 'Edge cases of the same interaction.' },
          { id: 'music', text: 'Title screen music.', correct: false, why: 'No connection to the change.' },
          { id: 'everything', text: 'Every level in the game, front to back, before replying.', correct: false, why: 'Thorough but disproportionate. Regression scope should follow what the change could affect.' },
        ],
      },
      {
        id: 'evidence', type: 'multi', skill: 'tracker',
        title: 'Record the right evidence',
        prompt: 'What should your verification record contain? Select all that apply.',
        options: [
          { id: 'build', text: 'The build number you tested.', correct: true, why: 'Ties the result to the code that was tested.' },
          { id: 'counts', text: 'Attempts and results for each check (e.g. 10/10 passed).', correct: true, why: 'Measured results, not impressions.' },
          { id: 'video', text: 'Video capture of the original steps passing, and of any new failure.', correct: true, why: 'Evidence others can review without re-running the test.' },
          { id: 'cases', text: 'Which test cases you ran, with pass/fail/blocked status.', correct: true, why: 'Shows coverage, including what could not be tested.' },
          { id: 'perfect', text: 'A statement that platforms now work perfectly.', correct: false, why: 'Overclaims. You tested specific cases, not everything.' },
          { id: 'devsays', text: 'The developer’s comment as proof that it is fixed.', correct: false, why: 'The developer’s claim is what you are verifying, not evidence.' },
        ],
      },
      {
        id: 'mark', type: 'classify', skill: 'regression',
        title: 'Mark each result',
        prompt: 'Here are your results on 0.9.430. Mark each test case.',
        categories: ['Pass', 'Fail', 'Blocked'],
        items: [
          { id: 'a', text: 'Original steps (descending platform, full jump), 10 attempts: rode the platform normally 10/10.', answer: 'Pass', why: 'The original defect no longer reproduces under the original conditions.' },
          { id: 'b', text: 'Sideways platform in level 2-4: character jitters and slides off in 3 of 5 attempts. This did not happen on 0.9.412.', answer: 'Fail', why: 'New behavior that worked before: a regression, likely from the shared change.' },
          { id: 'c', text: 'Rising platforms in 5-1: level 5-1 crashes while loading on this build, so you could not reach the platforms.', answer: 'Blocked', why: 'You couldn’t execute the test. Blocked is not a pass and not a fail of the platform behavior.' },
          { id: 'd', text: 'Stationary platforms in 3-2, 10 landings: all normal.', answer: 'Pass', why: 'Expected behavior confirmed.' },
        ],
      },
      {
        id: 'decision', type: 'single', skill: 'tracker', weight: 2,
        title: 'Decide what happens to the ticket',
        prompt: 'Given those results, what is the best next action?',
        options: [
          { id: 'best', text: 'Mark PIP-2214 verified for the original issue. File a new linked bug for the 2-4 sideways jitter as a regression of this fix. Note the 5-1 check as blocked and reference the load crash.', points: 1, why: 'Each problem gets its own trackable record, the relationship to the fix is visible, and nothing is marked passed that wasn’t tested.' },
          { id: 'reopen', text: 'Reopen PIP-2214 because some checks failed.', points: 0.5, why: 'Some teams prefer this when the regression is directly caused by the fix. But the original symptom is gone; mixing a new symptom into an old ticket makes tracking harder. Follow team convention, and link either way.' },
          { id: 'close', text: 'Close everything as passed, since the original bug is gone.', points: 0, why: 'Ignores a regression and an untested area.' },
          { id: 'fail', text: 'Mark the whole fix as failed.', points: 0.2, why: 'Inaccurate. The original issue did pass, and “failed” hides that the problem is now different.' },
        ],
      },
      {
        id: 'comment', type: 'text', skill: 'tracker', minWords: 30,
        title: 'Write the verification comment',
        prompt: 'Write the comment you would post on PIP-2214. Be specific and objective.',
        placeholder: 'Verified on 0.9.430…',
        groups: [
          { label: 'States the build tested', any: ['0.9.430', '430'] },
          { label: 'Reports the original steps result with numbers', any: [/10\s*(\/|of|out of)\s*10/, '10 attempts', '10 tries'] },
          { label: 'Mentions the sideways/2-4 regression and that it is tracked separately', any: ['2-4', 'sideways', 'jitter', 'regression', 'new bug', 'new ticket', 'linked'] },
          { label: 'Mentions the blocked 5-1 check', any: ['5-1', 'blocked', 'crash'] },
          { label: 'States a next step (retest when unblocked, etc.)', any: ['retest', 're-test', 'once', 'when the', 'after the', 'next build', 'follow up', 'follow-up'] },
        ],
        penalties: [
          { label: 'Overclaims (“works perfectly”, “all good”, “everything”) beyond what was tested.', any: ['perfect', 'all good', 'everything works', 'no issues', '100% fixed'] },
          { label: 'Blames or editorializes about the developer.', any: ['careless', 'sloppy', 'should have', 'obviously', 'again?'] },
        ],
      },
    ],
    modelInvestigation: `
      <p><strong>Model comment:</strong></p>
      <p class="pre spec">Verified on build 0.9.430 (dev kit, TV mode).
• Original steps (3-2, checkpoint B, full jump onto descending gear platform): 10/10 passed, rode platform normally. Video attached.
• Stationary platforms in 3-2: 10/10 passed.
• Sideways platform in 2-4: FAIL. Character jitters and slides off, 3/5 attempts. Did not occur on 0.9.412. Filed as PIP-2241 (linked, “caused by”).
• Rising platforms in 5-1: BLOCKED. Level 5-1 crashes on load in this build (PIP-2238).
Original issue verified. Will retest 5-1 platforms once PIP-2238 is fixed.</p>`,
  };

  const r2 = {
    id: 'r2',
    kind: 'regression',
    title: 'Verify the disconnect fix',
    game: 'Turbo Tumble Arena',
    tagline: 'A timeout was added so hosts aren’t stuck when a guest drops between rounds. Verify it without missing side effects.',
    skills: ['regression', 'multiplayer', 'tracker'],
    minutes: 10,
    briefing: `
      <p class="brief">Ticket <span class="mono">TTA-881</span>, “Host soft-locks on ‘Waiting for players…’ when guest disconnects during round transition”, is <strong>Resolved</strong>.<br>
      Developer comment: <em>“Fixed in 2.0.040. Host now times out a missing guest after 15 s during the transition and returns to lobby.”</em></p>
      <p>Verify the fix and decide what else the timeout could affect.</p>`,
    spec: [
      ['Original repro', 'Guest disconnects during the round 1→2 loading transition, no reconnect. Host stuck 3+ min. 4/4 attempts on 2.0.033.'],
      ['Fix build', '2.0.040'],
      ['Relevant spec', 'MP-01 (host notified within 15 s), MP-03 (reconnect within 30 s keeps score).'],
    ],
    steps: [
      {
        id: 'verify', type: 'multi', skill: 'regression',
        title: 'Verify the original defect',
        prompt: 'How do you verify the original issue? Select all that apply.',
        options: [
          { id: 'build', text: 'Install 2.0.040 on both kits and confirm the version on each.', correct: true, why: 'A mismatched build on one kit invalidates a multiplayer test.' },
          { id: 'steps', text: 'Repeat the original steps, disconnecting the guest the same way as before.', correct: true, why: 'Same conditions as the failure.' },
          { id: 'time', text: 'Time how long the host takes to return to the lobby.', correct: true, why: 'The fix claims 15 s; the spec requires it. Measure it.' },
          { id: 'several', text: 'Repeat several times.', correct: true, why: 'Network timing varies between attempts.' },
          { id: 'one', text: 'Run it once on one kit in single-player.', correct: false, why: 'The defect requires two connected kits.' },
        ],
      },
      {
        id: 'related', type: 'multi', skill: 'multiplayer',
        title: 'What else could the timeout affect?',
        prompt: 'Select the related checks worth running.',
        options: [
          { id: 'normal', text: 'A normal round transition with no disconnect (the happy path).', correct: true, why: 'A new timeout in the transition could slow down or break normal play.' },
          { id: 'reconnect', text: 'Guest reconnects within 10 s during the transition.', correct: true, why: 'A 15 s timeout interacts with MP-03’s 30 s reconnect window.' },
          { id: 'hostdrop', text: 'Host disconnects during the transition.', correct: true, why: 'The other side of the same code path.' },
          { id: 'four', text: 'A 4-player session where one guest drops.', correct: true, why: 'The fix may assume exactly two players.' },
          { id: 'solo', text: 'Single-player options menu.', correct: false, why: 'Not touched by the change.' },
          { id: 'color', text: 'Changing controller color settings.', correct: false, why: 'Unrelated to sessions.' },
        ],
      },
      {
        id: 'mark', type: 'classify', skill: 'regression',
        title: 'Mark each result',
        prompt: 'Your results on 2.0.040. Mark each test case.',
        categories: ['Pass', 'Fail', 'Blocked'],
        items: [
          { id: 'a', text: 'Guest drops during transition: host shows “A player has left” and returns to lobby after 15 s. 6/6 attempts.', answer: 'Pass', why: 'Matches MP-01 and the fix description.' },
          { id: 'b', text: 'Normal transition, no disconnect: round 2 now takes 15 s to start every time (was ~3 s).', answer: 'Fail', why: 'A regression introduced by the fix: the timeout seems to run even when nobody left.' },
          { id: 'c', text: '4-player session: only two dev kits are available today.', answer: 'Blocked', why: 'You cannot run the test. Record why and what you need.' },
          { id: 'd', text: 'Guest reconnects within 10 s during the transition: rejoins, score intact. 4/4.', answer: 'Pass', why: 'Meets MP-03.' },
        ],
      },
      {
        id: 'blocked', type: 'single', skill: 'regression', weight: 2,
        title: 'What does “Blocked” mean?',
        prompt: 'When is it correct to mark a test case Blocked?',
        options: [
          { id: 'right', text: 'When the test can’t be run because of something outside the test: missing hardware, a crash before the test point, a missing build or account.', points: 1, why: 'Blocked means “not executed”, with a reason, so it can be scheduled again.' },
          { id: 'bad', text: 'When the feature fails very badly.', points: 0, why: 'That is a Fail, possibly a high-severity one.' },
          { id: 'unsure', text: 'When you’re not sure whether the result is correct.', points: 0.25, why: 'Clarify the expected result with your lead or the spec, then mark Pass or Fail.' },
          { id: 'dev', text: 'When a developer asks you to skip it.', points: 0.25, why: 'Skipped or descoped tests are tracked differently. Note the decision and who made it.' },
        ],
      },
      {
        id: 'decision', type: 'single', skill: 'tracker', weight: 2,
        title: 'Decide what happens to the ticket',
        prompt: 'The original soft-lock is fixed, but every normal transition is now 15 s slower. What do you do?',
        options: [
          { id: 'best', text: 'Record the original issue as verified with evidence. File the 15 s delay as a regression linked to TTA-881, flag it to your lead as release-relevant, and mark the 4-player check blocked.', points: 1, why: 'Clear and traceable, and it makes sure the slowdown can’t slip through just because the original ticket passed.' },
          { id: 'reopen', text: 'Reopen TTA-881 with evidence of the delay.', points: 0.75, why: 'Defensible, since the fix itself causes the delay. Many teams do this; follow your team’s convention.' },
          { id: 'close', text: 'Close TTA-881. A slower transition is better than a soft-lock.', points: 0, why: 'Trading one defect for another without reporting it is not your call to make silently.' },
          { id: 'ignore4', text: 'Mark the 4-player case as passed, since 2-player works.', points: 0, why: 'Never mark something passed that you didn’t run.' },
        ],
      },
      {
        id: 'comment', type: 'text', skill: 'tracker', minWords: 30,
        title: 'Write the verification comment',
        prompt: 'Write the comment you would post on TTA-881.',
        placeholder: 'Verified on 2.0.040 (both kits)…',
        groups: [
          { label: 'States the build tested', any: ['2.0.040', '040'] },
          { label: 'Reports original-steps result with numbers', any: [/6\s*(\/|of|out of)\s*6/, '6 attempts', '15 s', '15s', '15 sec'] },
          { label: 'Mentions the normal-transition delay regression', any: ['delay', 'slower', '15 s to start', 'normal transition', 'regression', 'happy path'] },
          { label: 'Mentions the blocked 4-player check and why', any: ['4-player', '4 player', 'four', 'blocked'] },
          { label: 'States a next step', any: ['retest', 're-test', 'once', 'when', 'next build', 'follow up', 'follow-up', 'filed', 'linked'] },
        ],
        penalties: [
          { label: 'Overclaims beyond what was tested.', any: ['perfect', 'all good', 'everything works', 'no issues', '100% fixed'] },
        ],
      },
    ],
    modelInvestigation: `
      <p><strong>Model comment:</strong></p>
      <p class="pre spec">Verified on 2.0.040 (both kits confirmed).
• Original steps (guest drops during round 1→2 transition, no reconnect): PASS 6/6. Host shows “A player has left” and returns to lobby at ~15 s.
• Guest reconnect within 10 s during transition: PASS 4/4, score intact.
• Normal transition, no disconnect: FAIL. Round 2 now takes ~15 s to start every time (was ~3 s on 2.0.033). Filed TTA-902, linked to this fix.
• 4-player session with one drop: BLOCKED, only 2 dev kits available. Requested 2 more kits for tomorrow.
Original soft-lock verified fixed; flagging TTA-902 to lead as release-relevant.</p>`,
  };

  QA.REGRESSIONS = [r1, r2];
})(window.QA);
