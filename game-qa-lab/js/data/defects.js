/* Fictional defects for the Bug Report Lab, plus the evaluation keys used by
   the report step inside each mission. Keyword groups are lists of acceptable
   alternatives; a group is "covered" if any alternative appears. */
(function (QA) {
  'use strict';

  const D = [];

  /* ------------------------------ Bug Report Lab ------------------------------ */
  D.push({
    id: 'shop-cap',
    lab: true,
    name: 'Seed shop over the carry limit',
    game: 'Coral Cove Farm',
    area: 'Shop / inventory',
    difficulty: 'Starter',
    build: '3.4.120', platform: 'Dev kit, handheld mode',
    notes: `Build 3.4.120, dev kit in handheld mode. Save slot 2 ("QA_Shop").
Went to Bait & Seed shop in Coral Cove town.
Had 98 Turnip Seeds in bag already (checked bag first). Max stack is 99 per design doc INV-02.
Bought 2 Turnip Seeds (40 coins each). Shop accepted the purchase.
Bag now shows 99 Turnip Seeds. Coins went 1,000 -> 920. So paid 80 for 1 seed that fit.
No "bag full" message anywhere.
Tried 5 times (reloaded save each time) - same every time, 5/5.
Buying 1 seed at 98 works fine (pays 40, goes to 99).
Pretty sure the shop just doesn't check the bag at all. Also the shopkeeper's hat looks weird??`,
    spec: 'INV-02: Item stacks max out at 99. SHOP-05: The shop must not let the player buy more than they can carry; it shows “Your bag can’t hold any more.”',
    freq: { x: 5, y: 5 },
    severity: 'S3', severityNear: ['S2', 'S4'],
    priority: ['P2', 'P3'],
    kw: {
      title: [['shop', 'buy', 'purchas'], ['99', 'limit', 'max', 'cap', 'full', 'stack'], ['charg', 'coin', 'pay', 'paid', 'cost', 'money']],
      env: { build: ['3.4.120'], platform: ['handheld', 'dev kit'] },
      pre: [['98'], ['turnip', 'seed'], ['coin', '1,000', '1000']],
      steps: [['bait', 'shop', 'coral cove'], ['2', 'two', 'quantity'], ['buy', 'purchase', 'confirm'], ['bag', 'inventory', 'check', 'coin']],
      expected: [['can\'t hold', 'cant hold', 'blocked', 'prevent', 'not allow', 'limit', 'only 1', 'only one', 'message', 'shop-05']],
      actual: [['99', '80', '920', 'charged', 'paid', 'two', '2']],
    },
    model: {
      title: 'Shop charges for 2 Turnip Seeds when only 1 fits in bag (98 → 99 cap), no “bag full” message',
      env: 'Build 3.4.120 · Dev kit, handheld mode · Save slot 2 “QA_Shop”',
      pre: 'Player has 98 Turnip Seeds and 1,000 coins. Standing in Bait & Seed shop, Coral Cove town.',
      steps: ['Talk to the shopkeeper and choose “Buy”.', 'Select Turnip Seeds (40 coins each).', 'Set quantity to 2 and confirm the purchase.', 'Open the bag and check Turnip Seed count and coin total.'],
      expected: 'Per SHOP-05, the purchase is blocked or limited to 1 with “Your bag can’t hold any more.” If 1 seed is bought, 40 coins are charged.',
      actual: 'Purchase of 2 succeeds with no message. Bag shows 99 Turnip Seeds (1 added). Coins go from 1,000 to 920 (80 charged).',
      frequency: '5/5 attempts (save reloaded between attempts)',
      severity: 'S3', priority: 'P3',
      observations: 'Buying 1 seed at 98 behaves correctly (40 charged, bag shows 99). Not yet tested with other items or other shops.',
    },
  });

  D.push({
    id: 'map-crash',
    lab: true,
    name: 'Crash opening the map during autosave',
    game: 'Starlit Expedition',
    area: 'UI / autosave',
    difficulty: 'Intermediate',
    build: '0.7.301', platform: 'Dev kit, TV mode',
    notes: `0.7.301, TV mode on dev kit 14.
Walking from Frostfen into Glimmer Pass triggers the autosave (spinning star icon bottom-right).
If I press the Map button right when the star appears (within ~1 sec), the game freezes for 2 sec then closes with system error 2002-3141.
Did it 6 times: crashed 3 of 6. The other 3 the map opened normally.
Waiting until the star icon is gone and then opening the map: 10/10 fine.
After relaunching, the autosave from entering Glimmer Pass was there in 2 of 3 crashes. In 1 crash it loaded the previous save (back in Frostfen).
The map code is a mess and probably runs out of memory. This is going to crash for everyone!!!`,
    spec: 'UI-11: Opening the map during an autosave must either open normally or wait until saving completes.',
    freq: { x: 3, y: 6 },
    severity: 'S1', severityNear: ['S2'],
    priority: ['P1'],
    kw: {
      title: [['crash', 'error', 'closes'], ['map'], ['autosave', 'save', 'saving']],
      env: { build: ['0.7.301'], platform: ['tv', 'dev kit'] },
      pre: [['frostfen'], ['glimmer'], ['autosave', 'save']],
      steps: [['frostfen'], ['glimmer'], ['star', 'icon', 'autosave'], ['map'], ['1 sec', '1 s', 'second', 'immediately', 'within']],
      expected: [['open', 'wait', 'normally', 'ui-11']],
      actual: [['crash', 'closes', '2002', 'error'], ['freez', '2 sec', 'previous save', 'frostfen', 'lost']],
    },
    model: {
      title: 'Game crashes (error 2002-3141) when opening map within ~1 s of autosave starting at Frostfen → Glimmer Pass',
      env: 'Build 0.7.301 · Dev kit 14, TV mode',
      pre: 'Save loaded in Frostfen, near the exit to Glimmer Pass.',
      steps: ['Walk from Frostfen into Glimmer Pass.', 'Watch for the spinning star autosave icon (bottom-right).', 'Within about 1 second of the icon appearing, press the Map button.', 'Observe.'],
      expected: 'Per UI-11, the map opens normally, or waits until the autosave finishes.',
      actual: 'Game freezes for ~2 s, then closes with system error 2002-3141. After relaunch, 1 of 3 crashes had lost the Glimmer Pass autosave (loaded in Frostfen).',
      frequency: '3/6 attempts. Opening the map after the icon disappears: 0/10 crashes.',
      severity: 'S1', priority: 'P1',
      observations: 'Crash log and video attached. Only tested on this transition; other autosave points untested.',
    },
  });

  D.push({
    id: 'remap',
    lab: true,
    name: 'Button remap lost after controller reconnect',
    game: 'Velocity Drift',
    area: 'Input / settings',
    difficulty: 'Intermediate',
    build: '5.0.214', platform: 'Dev kit, TV mode, wireless controller',
    notes: `Velocity Drift 5.0.214, dev kit TV mode, one wireless controller (Pro-style, fw 4.1).
Options > Controls: changed Accelerate from A to Right Trigger. Saved. Works in race.
Started a race at Harbor Loop. Mid-race, turned the controller off (held sync button 3 s) and back on. It reconnected.
After reconnect: Right Trigger does nothing. A accelerates again (default).
Paused > Options > Controls still SAYS Accelerate = Right Trigger.
Re-saving the controls screen fixes it until the next reconnect.
4/4 times.
Didn't try wired. Didn't try two controllers. Didn't try other buttons.
I bet nobody remaps anyway, low priority imo.`,
    spec: 'INP-07: Custom button mappings persist for the session and are reapplied when a controller reconnects.',
    freq: { x: 4, y: 4 },
    severity: 'S2', severityNear: ['S3', 'S1'],
    priority: ['P2'],
    kw: {
      title: [['remap', 'mapping', 'binding', 'custom control', 'button'], ['reconnect', 'disconnect', 'turn', 'off and on'], ['default', 'revert', 'reset', 'lost', 'not applied']],
      env: { build: ['5.0.214'], platform: ['wireless', 'controller', 'tv'] },
      pre: [['accelerate'], ['right trigger', 'rt', 'r trigger', 'remap']],
      steps: [['options', 'controls', 'settings'], ['accelerate'], ['right trigger', 'trigger'], ['race', 'harbor'], ['off', 'disconnect', 'sync'], ['reconnect', 'back on', 'on again']],
      expected: [['right trigger', 'custom', 'remain', 'still', 'persist', 'reappl', 'inp-07']],
      actual: [['does nothing', 'default', 'a accelerates', 'reverts', 'not work'], ['menu', 'still says', 'still shows', 'options']],
    },
    model: {
      title: 'Custom Accelerate mapping (Right Trigger) reverts to default after wireless controller reconnects; menu still shows custom mapping',
      env: 'Build 5.0.214 · Dev kit, TV mode · 1 wireless controller (fw 4.1)',
      pre: 'In Options > Controls, Accelerate has been remapped from A to Right Trigger and saved.',
      steps: ['Start any race (used Harbor Loop).', 'Confirm Right Trigger accelerates.', 'Turn the controller off by holding the sync button for 3 s.', 'Turn it back on and let it reconnect.', 'Press Right Trigger, then A.', 'Pause and open Options > Controls.'],
      expected: 'Per INP-07, Right Trigger still accelerates after reconnecting.',
      actual: 'Right Trigger does nothing; A accelerates (default mapping). Options > Controls still shows Accelerate = Right Trigger.',
      frequency: '4/4 attempts',
      severity: 'S2', priority: 'P2',
      observations: 'Re-saving the Controls screen restores the mapping until the next reconnect. Untested: wired controller, multiple controllers, other remapped actions.',
    },
  });

  D.push({
    id: 'subtitle',
    lab: true,
    name: 'Subtitle text clipped in cutscene',
    game: 'Ember Road',
    area: 'Localization / UI',
    difficulty: 'Starter',
    build: '2.2.006', platform: 'Dev kit, TV mode, language: Spanish',
    notes: `Build 2.2.006, TV mode, system language set to Spanish.
Chapter 2 opening cutscene ("La Forja"), around 0:42, Mara's long line.
Subtitle box shows 2 lines but the text needs 3 - the last line is cut off. You can only read "...y no volveremos a" and then it stops.
English version of the same line fits fine (2 lines).
Watched the cutscene 3 times, same every time 3/3. Also happens in handheld.
Whoever did the Spanish translation made the line way too long. This looks really bad and players will hate it, it's a huge problem.`,
    spec: 'LOC-03: Subtitles must display the full line of dialogue in every supported language, wrapping to up to 3 lines.',
    freq: { x: 3, y: 3 },
    severity: 'S4', severityNear: ['S3'],
    priority: ['P2', 'P3'],
    kw: {
      title: [['subtitle'], ['cut off', 'clipped', 'truncat', 'cut', 'missing'], ['spanish', 'es', 'españ'], ['chapter 2', 'forja', 'cutscene']],
      env: { build: ['2.2.006'], platform: ['tv', 'spanish'] },
      pre: [['spanish', 'language']],
      steps: [['spanish', 'language'], ['chapter 2', 'forja'], ['cutscene'], ['0:42', '42', 'mara']],
      expected: [['full', 'entire', 'complete', '3 lines', 'three lines', 'wrap', 'loc-03']],
      actual: [['cut', 'clip', 'truncat', 'missing', 'only 2', 'two lines', 'volveremos']],
    },
    model: {
      title: '[ES] Subtitle clipped in Chapter 2 “La Forja” cutscene at ~0:42; last line of Mara’s dialogue not shown',
      env: 'Build 2.2.006 · Dev kit, TV mode (also seen handheld) · System language: Spanish',
      pre: 'System language set to Spanish. Save at the start of Chapter 2.',
      steps: ['Start Chapter 2 to trigger the “La Forja” opening cutscene.', 'Let it play to about 0:42 (Mara’s long line).', 'Read the subtitle box.'],
      expected: 'Per LOC-03, the full line is shown, wrapping to up to 3 lines.',
      actual: 'Only 2 lines are shown; the third is cut off. Visible text ends at “…y no volveremos a”.',
      frequency: '3/3 viewings',
      severity: 'S4', priority: 'P3',
      observations: 'The English version of the same line fits in 2 lines. Screenshot attached. Other languages not checked.',
    },
  });

  D.push({
    id: 'coop-key',
    lab: true,
    name: 'Key item vanishes when co-op player leaves',
    game: 'Moss & Mortar',
    area: 'Local co-op / items',
    difficulty: 'Advanced',
    build: '1.0.552', platform: 'Dev kit, TV mode, 2 controllers',
    notes: `Moss & Mortar 1.0.552, TV mode, 2 controllers, local co-op.
Level "Sunken Library". Player 2 picks up the Brass Key (P2 is carrying it, key icon over their head).
Player 2 leaves (Pause > Drop Out).
Key is gone. Not on the floor, not in P1's inventory, not back on its pedestal.
Brass Door can't be opened -> can't finish the level.
Pause > Restart from Checkpoint brings the key back to the pedestal.
5/5. When P1 carries the key and P2 drops out, key is fine (3/3).
Same thing probably happens with every item and also online co-op I'd guess.`,
    spec: 'COOP-04: When a player drops out, any carried item is dropped at their position.',
    freq: { x: 5, y: 5 },
    severity: 'S2', severityNear: ['S1', 'S3'],
    priority: ['P2'],
    kw: {
      title: [['key', 'item'], ['drop out', 'drops out', 'leave', 'leaves', 'player 2', 'p2', 'co-op', 'coop'], ['vanish', 'disappear', 'lost', 'gone', 'missing', 'deleted']],
      env: { build: ['1.0.552'], platform: ['tv', 'controller', 'local co-op', 'co-op'] },
      pre: [['co-op', 'coop', 'two players', '2 players', 'player 2'], ['sunken library', 'library']],
      steps: [['sunken library', 'library'], ['player 2', 'p2'], ['brass key', 'key'], ['drop out', 'drops out', 'pause']],
      expected: [['dropped', 'on the floor', 'at their position', 'ground', 'coop-04']],
      actual: [['gone', 'vanish', 'disappear', 'not on the floor', 'missing'], ['door', 'can\'t', 'cannot', 'unable']],
    },
    model: {
      title: 'Brass Key disappears when Player 2 drops out of local co-op while carrying it; Brass Door can’t be opened',
      env: 'Build 1.0.552 · Dev kit, TV mode · Local co-op, 2 controllers',
      pre: 'Two players in local co-op, level “Sunken Library”, before the Brass Door.',
      steps: ['Have Player 2 pick up the Brass Key from its pedestal.', 'While Player 2 is carrying the key, Player 2 opens Pause and selects Drop Out.', 'Look for the key on the floor, on its pedestal, and in Player 1’s inventory.', 'With Player 1, try to open the Brass Door.'],
      expected: 'Per COOP-04, the key drops at Player 2’s position when they drop out.',
      actual: 'The key is gone: not on the floor, not on the pedestal, not in Player 1’s inventory. The Brass Door can’t be opened, so the level can’t be completed.',
      frequency: '5/5 attempts. When Player 1 carries the key and Player 2 drops out: 0/3.',
      severity: 'S2', priority: 'P2',
      observations: 'Workaround: Pause > Restart from Checkpoint returns the key to its pedestal. Untested: other carried items, online co-op.',
    },
  });

  /* ------------------------- Mission report keys (not in lab list) ------------------------- */
  D.push({
    id: 'm1-platform', lab: false,
    name: 'Fall-through on descending platform', game: 'Pebble & Pip: Skyward Isles',
    build: '0.9.412', platform: 'Dev kit, TV mode',
    freq: { x: 4, y: 5 },
    severity: 'S2', severityNear: ['S1', 'S3'], priority: ['P2'],
    kw: {
      title: [['platform'], ['fall', 'fell', 'through', 'drop'], ['descend', 'moving down', 'downward', 'going down'], ['full jump', 'jump']],
      env: { build: ['0.9.412'], platform: ['tv', 'dev kit'] },
      pre: [['3-2', 'cogwork'], ['checkpoint b', 'checkpoint']],
      steps: [['3-2', 'cogwork', 'checkpoint'], ['wait', 'until', 'descend', 'moving down', 'going down'], ['full jump', 'hold', 'jump'], ['land', 'onto', 'on the platform']],
      expected: [['stay', 'remain', 'carr', 'ride', 'stand', 'stays on']],
      actual: [['fall', 'fell', 'through', 'drop'], ['life', 'respawn', 'checkpoint', 'die']],
    },
    model: {
      title: 'Character falls through descending gear platform after a full jump (3-2 Cogwork Canyon)',
      env: 'Build 0.9.412 · Dev kit, TV mode',
      pre: 'Level 3-2 “Cogwork Canyon” loaded from checkpoint B. Gear platform after checkpoint B is on the only path forward.',
      steps: ['From checkpoint B, walk to the edge before the gear platform.', 'Wait until the platform is moving downward.', 'Do a full jump (hold the jump button) onto the platform.', 'Land anywhere on the platform’s top surface and observe.'],
      expected: 'Per LVL-3-2-04, the character stays on the platform and is carried by it.',
      actual: 'The character touches the platform top, then drops through it about 0.2 s later, loses 1 life and respawns at checkpoint B.',
      frequency: '4/5 attempts. Short hops onto the descending platform: 0 failures. Sideways and rising movement: 0 failures.',
      severity: 'S2', priority: 'P2',
      observations: 'Landing spot (center vs. edge) made no difference. Moving platforms in other levels untested. Video attached.',
    },
  });

  D.push({
    id: 'm2-save', lab: false,
    name: 'Progress lost when exiting during results', game: 'Lantern Lane',
    build: '1.2.087', platform: 'Dev kit',
    freq: { x: 3, y: 4 },
    severity: 'S2', severityNear: ['S1', 'S3'], priority: ['P2'],
    kw: {
      title: [['progress', 'save', 'complet', 'level'], ['lost', 'not saved', 'missing', 'lose', 'reset', 'incomplete'], ['results', 'before save icon', 'before the save icon', 'exit', 'close', 'quit', 'power']],
      env: { build: ['1.2.087'], platform: ['dev kit'] },
      pre: [['4-3', 'clocktower']],
      steps: [['4-3', 'clocktower', 'complete'], ['results'], ['close', 'power', 'quit', 'exit'], ['relaunch', 'restart', 'reopen', 'launch', 'start the game'], ['check', 'level select', 'status', 'map']],
      expected: [['complete', 'saved', 'kept', 'retain', 'sav-03', 'not lose']],
      actual: [['not complete', 'incomplete', 'lost', 'not saved', 'missing', 'not marked']],
    },
    model: {
      title: 'Level completion lost when software is closed or powered off during results screen (before save icon appears)',
      env: 'Build 1.2.087 · Dev kit',
      pre: 'Save file with levels up to 4-2 complete. Level 4-3 “Clocktower” not yet complete.',
      steps: ['Complete level 4-3 “Clocktower”.', 'While the results screen is showing (before the save icon appears), close the software from the system menu.', 'Relaunch the game and load the same save.', 'Check level 4-3 status on the level select.'],
      expected: 'Per SAV-01/SAV-03, level 4-3 is shown as complete.',
      actual: 'Level 4-3 is shown as not complete. Earlier levels are intact and the save loads normally.',
      frequency: '3/4 attempts (close software); 3/4 (power off). Return to title at the same moment: 0 losses. Exit after the save icon disappears: 0 losses.',
      severity: 'S2', priority: 'P2',
      observations: 'Power-off while the save icon is displayed also loses progress, but this matches the SAV-02 warning and is not part of this report. Claims about build 1.1 and save corruption are unverified.',
    },
  });

  D.push({
    id: 'm3-mp', lab: false,
    name: 'Host stuck when guest drops during transition', game: 'Turbo Tumble Arena',
    build: '2.0.033', platform: 'Two dev kits, local test network',
    freq: { x: 4, y: 4 },
    severity: 'S1', severityNear: ['S2'], priority: ['P1', 'P2'],
    kw: {
      title: [['host'], ['stuck', 'soft-lock', 'softlock', 'soft lock', 'hang', 'waiting', 'frozen', 'lock'], ['disconnect', 'drop', 'leave', 'left'], ['transition', 'loading', 'round 2', 'between rounds']],
      env: { build: ['2.0.033'], platform: ['two', '2', 'kit'] },
      pre: [['host'], ['guest']],
      steps: [['host'], ['guest'], ['transition', 'loading'], ['disconnect', 'unplug']],
      expected: [['player has left', 'lobby', '15', 'mp-01']],
      actual: [['waiting for players', 'stuck', 'soft', 'hang'], ['3 min', 'minutes', 'pause', 'close the software', 'indefinite', 'never']],
    },
    model: {
      title: 'Host soft-locks on “Waiting for players…” when guest disconnects during round transition',
      env: 'Build 2.0.033 · Two dev kits on local test network',
      pre: 'Kit A hosts an online 2-player match; Kit B joins as guest.',
      steps: ['On Kit A, host a match. On Kit B, join it.', 'Play round 1 to completion.', 'As soon as the round 2 loading screen appears, unplug Kit B’s network cable.', 'Watch Kit A’s screen for 3 minutes and try to open the pause menu.'],
      expected: 'Per MP-01, Kit A shows “A player has left” within 15 s and returns to the lobby.',
      actual: 'Kit A shows “Waiting for players…” indefinitely (waited 3 min). Pause menu does not open. The only way out is to close the software.',
      frequency: '4/4 attempts',
      severity: 'S1', priority: 'P1',
      observations: 'Separate issue: if Kit B reconnects within 10 s during the transition, the guest score resets to 0 in 3 of 4 attempts (filed separately).',
    },
  });

  QA.DEFECTS = D;
  QA.defectById = (id) => D.find((d) => d.id === id);
})(window.QA);
