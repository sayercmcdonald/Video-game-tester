/* Test Case Workshop exercises. Coverage categories are detected from the
   trainee's own test cases using keyword groups (transparent and local). */
(function (QA) {
  'use strict';

  QA.WORKSHOP = [
    {
      id: 'boundary',
      topic: 'Boundary conditions',
      title: 'Inventory stack limit',
      game: 'Coral Cove Farm',
      feature: 'Each item type stacks from 1 to 99 in the bag. Picking up an item when its stack is at 99 leaves it on the ground and shows “Your bag can’t hold any more.” Selling reduces the stack; at 0 the slot is removed.',
      why: 'Bugs cluster at the edges of ranges: 0, 1, the maximum, and one past the maximum. Testing only “normal” values misses them.',
      coverage: [
        { label: 'Just below the limit (98 → 99)', any: ['98'] },
        { label: 'Exactly at the limit (99)', any: ['99', 'max', 'maximum', 'full stack'] },
        { label: 'Past the limit (pick up at 99 / 100)', any: ['100', 'at 99', 'over', 'exceed', 'beyond', 'can\'t hold', 'cant hold', 'bag full', 'full bag'] },
        { label: 'Lower boundary (1 → 0, empty slot)', any: [' 0', 'zero', 'empty', 'last item', 'slot is removed', 'slot removed', 'sell all', '1 item', ' 1 '] },
        { label: 'Message / feedback shown to player', any: ['message', 'can\'t hold', 'cant hold', 'shows', 'displayed', 'text'] },
      ],
      models: [
        { title: 'Pick up item when stack is at 98', pre: 'Bag has 98 Turnip Seeds.', steps: '1. Pick up 1 Turnip Seed from the ground.\n2. Open the bag.', expected: 'Stack shows 99. Item removed from ground. No message.' },
        { title: 'Pick up item when stack is at 99 (limit)', pre: 'Bag has 99 Turnip Seeds.', steps: '1. Walk over 1 Turnip Seed on the ground.\n2. Open the bag.', expected: '“Your bag can’t hold any more.” shown. Seed stays on the ground. Stack stays 99.' },
        { title: 'Sell the last item in a stack', pre: 'Bag has exactly 1 Turnip Seed.', steps: '1. Sell 1 Turnip Seed at the shop.\n2. Open the bag.', expected: 'Turnip Seed slot is removed. Coins increase by the sell price.' },
      ],
    },
    {
      id: 'unusual',
      topic: 'Unusual player actions',
      title: 'Boss intro cutscene',
      game: 'Starlit Expedition',
      feature: 'A 40-second cutscene plays before the Frost Wyrm boss. It can be skipped by holding the Skip button for 1 second. After it ends, the battle starts with the player at full health.',
      why: 'Players do things designers don’t expect: pausing at odd moments, mashing buttons, unplugging controllers. These actions often reach states the game never tested.',
      coverage: [
        { label: 'Pause during the cutscene', any: ['pause'] },
        { label: 'Skip at different times / mash skip', any: ['skip', 'mash', 'spam', 'rapid'] },
        { label: 'Controller disconnect during cutscene', any: ['disconnect', 'controller off', 'unplug', 'battery', 'turn off the controller'] },
        { label: 'Suspend / close / sleep during cutscene', any: ['sleep', 'suspend', 'close', 'home', 'system menu', 'quit'] },
        { label: 'Input at the exact transition into battle', any: ['transition', 'last second', 'final frame', 'as it ends', 'right when', 'at the end', 'press attack', 'move during'] },
      ],
      models: [
        { title: 'Pause during cutscene, then resume', pre: 'At the Frost Wyrm door.', steps: '1. Enter the boss room to start the cutscene.\n2. At ~10 s, press Pause.\n3. Wait 30 s, then resume.', expected: 'Cutscene resumes from the paused frame; audio stays in sync; battle starts normally.' },
        { title: 'Hold Skip in the last second of the cutscene', pre: 'At the Frost Wyrm door.', steps: '1. Start the cutscene.\n2. At ~39 s, hold Skip for 1 s.', expected: 'Battle starts once, player at full health. No duplicate boss or repeated cutscene.' },
        { title: 'Disconnect controller during cutscene', pre: 'One wireless controller connected.', steps: '1. Start the cutscene.\n2. At ~20 s, turn the controller off.\n3. Turn it back on after the cutscene ends.', expected: 'Controller-disconnected prompt appears; battle does not start until a controller reconnects.' },
      ],
    },
    {
      id: 'repeat',
      topic: 'Repeated actions',
      title: 'Fast travel menu',
      game: 'Lantern Lane',
      feature: 'Fast travel moves the player between unlocked lanterns. Opening the map, selecting a lantern and confirming plays a 2-second fade, then loads the destination.',
      why: 'Some defects appear only after many repetitions: memory that slowly runs out, counters that overflow, states that drift. Repetition is boring, and that is exactly why it finds bugs.',
      coverage: [
        { label: 'Repeat many times (10+, with a number)', any: [/\b(1\d|[2-9]\d|\d{3,})\s*(times|x|repetitions|trips|loops)/, '10 times', 'twenty', 'fifty', '100 times'] },
        { label: 'Rapid input (spam confirm/cancel)', any: ['rapid', 'spam', 'mash', 'quickly', 'repeatedly press', 'double'] },
        { label: 'Same destination back and forth', any: ['back and forth', 'same lantern', 'same destination', 'between two', 'a to b'] },
        { label: 'Check performance or memory over time', any: ['load time', 'frame', 'performance', 'memory', 'slow', 'stutter', 'time each'] },
        { label: 'Check state after repetition (position, items, time)', any: ['position', 'inventory', 'items', 'time of day', 'state', 'correct location', 'still'] },
      ],
      models: [
        { title: 'Fast travel 50 times between two lanterns', pre: 'Lanterns A and B unlocked.', steps: '1. Fast travel A → B.\n2. Fast travel B → A.\n3. Repeat until 50 trips total, noting load time every 10th trip.', expected: 'Every trip arrives at the correct lantern. Load time stays within ±1 s of the first trip.' },
        { title: 'Press Confirm rapidly on the destination', pre: 'Map open, lantern B selected.', steps: '1. Press Confirm 5 times as fast as possible.', expected: 'One fade and one load. Player arrives at B once.' },
      ],
    },
    {
      id: 'saveload',
      topic: 'Save / load behavior',
      title: 'Manual save slots',
      game: 'Moss & Mortar',
      feature: 'Three manual save slots. Saving to an occupied slot asks “Overwrite?”. Slots can be deleted. Loading restores location, inventory and play time.',
      why: 'Save systems protect the player’s time. Defects here are among the most damaging, so test each operation and what happens when it is interrupted.',
      coverage: [
        { label: 'Save then load and compare state', any: ['load', 'restore'] },
        { label: 'Overwrite an occupied slot (and cancel)', any: ['overwrite', 'occupied', 'existing'] },
        { label: 'Delete a slot', any: ['delete', 'erase', 'remove'] },
        { label: 'Interrupted save (power off / close)', any: ['power', 'close the software', 'interrupt', 'during save', 'while saving', 'quit during'] },
        { label: 'Relaunch persistence', any: ['relaunch', 'restart', 'reopen', 'after closing', 'next session', 'reboot'] },
        { label: 'Verify specific data (location, inventory, time)', any: ['location', 'inventory', 'play time', 'playtime', 'items', 'position'] },
      ],
      models: [
        { title: 'Save, relaunch, load: state restored', pre: 'In Sunken Library with 3 keys, play time noted.', steps: '1. Save to slot 1.\n2. Close the software and relaunch.\n3. Load slot 1.', expected: 'Location, 3 keys and play time match what was noted before saving.' },
        { title: 'Cancel overwrite keeps old data', pre: 'Slot 2 holds an older save.', steps: '1. Choose Save > Slot 2.\n2. At “Overwrite?”, choose No.\n3. Load slot 2.', expected: 'Slot 2 still contains the older save.' },
        { title: 'Power off during save', pre: 'Slot 3 holds an older save.', steps: '1. Save to slot 3 and confirm overwrite.\n2. Power off while the save icon is shown.\n3. Power on and open Load.', expected: 'Slot 3 contains either the old or the new save and loads without error. No corruption message.' },
      ],
    },
    {
      id: 'input',
      topic: 'Controller & input differences',
      title: 'Two-player controls',
      game: 'Turbo Tumble Arena',
      feature: 'Local play supports one controller per player or one controller split sideways between two players (fewer buttons). Players can remap Jump and Dash.',
      why: 'The same action can come from different devices and layouts. Each combination is its own path through the input code.',
      coverage: [
        { label: 'Single split controller vs. separate controllers', any: ['split', 'sideways', 'shared controller', 'one controller', 'separate controller', 'two controllers', '2 controllers'] },
        { label: 'Controller disconnect / reconnect mid-game', any: ['disconnect', 'reconnect', 'battery', 'turn off'] },
        { label: 'Remapped buttons', any: ['remap', 'mapping', 'rebind', 'custom'] },
        { label: 'Simultaneous / conflicting inputs', any: ['simultaneous', 'same time', 'both press', 'at once', 'hold both', 'opposite'] },
        { label: 'Different display / play modes (TV vs. handheld)', any: ['handheld', 'tv mode', 'docked', 'tabletop', 'display mode'] },
      ],
      models: [
        { title: 'Jump and Dash on a sideways split controller', pre: 'Two players, one controller split sideways.', steps: '1. Player 1 presses Jump, then Dash.\n2. Player 2 does the same.', expected: 'Each action works for the correct player using the reduced button layout shown in the controls screen.' },
        { title: 'Remapped Jump survives reconnect', pre: 'Player 1 remapped Jump to Right Trigger.', steps: '1. Start a match.\n2. Turn Player 1’s controller off and on.\n3. Press Right Trigger.', expected: 'Player 1 jumps.' },
      ],
    },
    {
      id: 'multiplayer',
      topic: 'Multiplayer states',
      title: 'Online 4-player lobby',
      game: 'Turbo Tumble Arena',
      feature: 'A host creates a lobby for up to 4 players. Players can join by code, leave at any time, and the host starts the match when 2+ players are ready.',
      why: 'Multiplayer adds state that must stay in sync across machines: who is present, who is ready, who is host. Most defects happen when that state changes.',
      coverage: [
        { label: 'Join and leave', any: ['join', 'leave', 'leaves'] },
        { label: 'Lobby full (5th player tries to join)', any: ['5th', 'fifth', 'full', '4 players', 'four players', 'max'] },
        { label: 'Host leaves', any: ['host leaves', 'host left', 'host quits', 'host disconnect'] },
        { label: 'Ready / start conditions (fewer than 2 ready)', any: ['ready', 'start', 'only 1', 'one player'] },
        { label: 'Network trouble (lag, disconnect, reconnect)', any: ['lag', 'latency', 'disconnect', 'reconnect', 'packet', 'unplug', 'network'] },
      ],
      models: [
        { title: 'Fifth player cannot join full lobby', pre: '4 players in lobby on kits A–D.', steps: '1. On kit E, enter the lobby code.', expected: 'Kit E sees “Lobby is full.” Lobby on A–D unchanged.' },
        { title: 'Host leaves lobby', pre: '3 players in lobby, kit A is host.', steps: '1. On kit A, choose Leave Lobby.\n2. Observe kits B and C.', expected: 'B and C return to the main menu with “The host has left the session.”' },
        { title: 'Start is disabled with 1 ready player', pre: '2 players in lobby, only host ready.', steps: '1. Host presses Start.', expected: 'Start is disabled or shows “Waiting for players to be ready.”' },
      ],
    },
    {
      id: 'compat',
      topic: 'Compatibility & regression',
      title: 'Day-one patch 1.0.1',
      game: 'Ember Road',
      feature: 'Patch 1.0.1 changes the save format and fixes two crashes. Players may install it over 1.0.0 with existing saves, on different system software versions, in TV or handheld mode.',
      why: 'Compatibility testing checks that the game works across the environments players actually have. Regression testing checks the update didn’t break what already worked.',
      coverage: [
        { label: 'Old (1.0.0) save loads after updating', any: ['1.0.0 save', 'old save', 'existing save', 'previous save', 'save from 1.0.0'] },
        { label: 'Different system software versions', any: ['system software', 'firmware', 'os version', 'system version'] },
        { label: 'Display modes (TV / handheld)', any: ['handheld', 'tv mode', 'docked', 'display mode'] },
        { label: 'Low storage / install conditions', any: ['storage', 'space', 'sd card', 'install', 'download'] },
        { label: 'Previously fixed bugs re-checked', any: ['previously fixed', 'regression', 'old bug', 'fixed crash', 'crash fix', 'retest'] },
      ],
      models: [
        { title: '1.0.0 save loads after updating to 1.0.1', pre: 'Save in Chapter 3 created on 1.0.0.', steps: '1. Install patch 1.0.1.\n2. Launch and load the Chapter 3 save.', expected: 'Save loads; chapter, inventory and play time match 1.0.0.' },
        { title: 'Patch install with low storage', pre: 'Less free space than the patch size.', steps: '1. Start the 1.0.1 download.', expected: 'System shows a storage error. 1.0.0 still launches and saves are intact.' },
        { title: 'Re-verify fixed crash #1 on 1.0.1', pre: 'Patch 1.0.1 installed.', steps: '1. Follow the original repro steps for crash #1, 5 times.', expected: 'No crash in 5/5 attempts.' },
      ],
    },
  ];

  QA.workshopById = (id) => QA.WORKSHOP.find((w) => w.id === id);
})(window.QA);
