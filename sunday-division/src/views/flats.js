'use strict';
const { raw } = require('../lib/util');

/**
 * Technical flat drawings for the studio's concept studies, drawn in code as SVG.
 * Each garment is described as a left half (viewer's left) and mirrored about x = 200.
 * Classes: .ln solid construction line · .st dashed topstitch · .dm dimension line.
 */
const mirror = (half) => `<g>${half}</g><g transform="translate(400 0) scale(-1 1)">${half}</g>`;
const ln = (d) => `<path class="ln" pathLength="1" d="${d}"/>`;
const st = (d) => `<path class="st" d="${d}"/>`;

const GARMENTS = {
  overshirt: {
    front: mirror(
      ln('M200 94 L172 62 L106 86') + ln('M122 172 L118 410 Q160 417 200 417') +
      ln('M106 86 L44 318 L82 330 L122 172') + ln('M106 86 Q128 126 122 172') +
      ln('M49 300 L87 312') + ln('M172 62 Q186 50 200 50') + ln('M172 62 L160 100 L197 91') +
      ln('M132 152 H176 V208 H132 Z') + ln('M130 150 H178 V164 L154 173 L130 164 Z') +
      st('M119 402 Q160 409 200 409') + st('M136 156 V204 H172 V168') + ln('M192 96 V416'),
    ) + [128, 186, 244, 302, 360].map((y) => `<circle class="ln" cx="200" cy="${y}" r="3.2"/>`).join('') +
      '<circle class="ln" cx="154" cy="162" r="2.4"/><circle class="ln" cx="246" cy="162" r="2.4"/>',
    back: mirror(
      ln('M172 62 L106 86') + ln('M122 172 L118 410 Q160 417 200 417') +
      ln('M106 86 L44 318 L82 330 L122 172') + ln('M106 86 Q128 126 122 172') +
      ln('M49 300 L87 312') + ln('M172 62 Q186 48 200 48') + ln('M172 62 Q186 70 200 70') +
      ln('M111 106 Q160 116 200 116') + ln('M193 116 V200') + st('M119 402 Q160 409 200 409') +
      ln('M66 306 L72 268') + st('M112 111 Q160 121 200 121'),
    ),
  },
  trouser: {
    front: mirror(
      ln('M200 56 H128 L126 78 H200') + ln('M126 78 Q110 176 102 440 L186 445 L200 198') +
      ln('M144 78 L117 156') + ln('M166 78 L162 146') + ln('M150 52 H157 V82 H150 Z') +
      st('M103 426 L187 431') + st('M150 160 L144 438'),
    ) + ln('M200 78 V198') + st('M214 78 V168 Q214 190 200 192') + '<circle class="ln" cx="207" cy="67" r="3"/>',
    back: mirror(
      ln('M200 56 H128 L126 78 H200') + ln('M126 78 Q110 176 102 440 L186 445 L200 198') +
      ln('M162 78 V116') + ln('M140 124 H180 V131 H140 Z') + ln('M150 52 H157 V82 H150 Z') +
      st('M103 426 L187 431') + st('M150 160 L144 438') + '<circle class="ln" cx="160" cy="138" r="2.4"/>',
    ) + ln('M200 56 V198') + ln('M196 52 H204 V82 H196 Z'),
  },
  coat: {
    front: mirror(
      ln('M176 58 L104 82') + ln('M118 170 Q112 320 100 452 Q150 459 200 459') +
      ln('M104 82 L50 332 L88 342 L118 170') + ln('M104 82 Q126 124 118 170') + ln('M54 312 L92 322') +
      ln('M176 58 Q188 48 200 48') + ln('M176 58 L152 98 L171 110 L147 121 L200 214') + ln('M176 58 L200 214') +
      ln('M126 286 L160 272 L163 281 L129 295 Z') + st('M101 440 Q150 447 200 447'),
    ) + ln('M208 214 V458') + [240, 300, 360].map((y) => `<circle class="ln" cx="198" cy="${y}" r="3.4"/>`).join(''),
    back: mirror(
      ln('M176 58 L104 82') + ln('M118 170 Q112 320 100 452 Q150 459 200 459') +
      ln('M104 82 L50 332 L88 342 L118 170') + ln('M104 82 Q126 124 118 170') + ln('M54 312 L92 322') +
      ln('M176 58 Q188 46 200 46') + ln('M176 58 Q188 68 200 68') + ln('M110 108 Q160 150 200 156') +
      st('M101 440 Q150 447 200 447') + ln('M124 246 H200 V262 H124 Z'),
    ) + ln('M200 156 V459') + ln('M200 340 L212 346 V458') + '<circle class="ln" cx="182" cy="254" r="2.6"/><circle class="ln" cx="218" cy="254" r="2.6"/>',
  },
  tee: {
    front: mirror(
      ln('M170 62 L102 86') + ln('M122 154 L120 400 Q160 406 200 406') +
      ln('M102 86 L60 172 L100 190 L122 154') + ln('M102 86 Q126 118 122 154') +
      ln('M170 62 Q174 92 200 96') + ln('M162 65 Q168 102 200 106') +
      st('M64 164 L104 182') + st('M120 390 Q160 396 200 396'),
    ),
    back: mirror(
      ln('M170 62 L102 86') + ln('M122 154 L120 400 Q160 406 200 406') +
      ln('M102 86 L60 172 L100 190 L122 154') + ln('M102 86 Q126 118 122 154') +
      ln('M170 62 Q184 72 200 72') + ln('M162 65 Q180 82 200 82') +
      st('M64 164 L104 182') + st('M120 390 Q160 396 200 396') + st('M138 74 Q170 96 200 96'),
    ),
  },
};

/** Dimension line with end ticks and a label, for the annotated hero drawing. */
function dim(x1, y1, x2, y2, label, lx, ly, anchor = 'middle') {
  const horizontal = y1 === y2;
  const tick = horizontal
    ? `M${x1} ${y1 - 5}V${y1 + 5}M${x2} ${y2 - 5}V${y2 + 5}`
    : `M${x1 - 5} ${y1}H${x1 + 5}M${x2 - 5} ${y2}H${x2 + 5}`;
  return `<path class="dm" d="M${x1} ${y1}L${x2} ${y2}${tick}"/><text class="dm-t" x="${lx}" y="${ly}" text-anchor="${anchor}">${label}</text>`;
}

function flat(garment, view = 'front', { title } = {}) {
  const g = GARMENTS[garment];
  const label = title || `${garment} technical flat, ${view} view`;
  return raw(`<svg class="flat" viewBox="20 30 360 440" role="img" aria-label="${label}">${g[view]}</svg>`);
}

/** Overshirt front with points-of-measure callouts. */
function annotatedFlat() {
  const dims =
    dim(122, 448, 278, 448, 'A · CHEST 61', 200, 466) +
    dim(318, 62, 318, 417, 'B · LENGTH 74', 330, 244, 'start') +
    dim(172, 30, 228, 30, 'C · NECK 20', 200, 22) +
    dim(26, 96, 26, 322, 'D · SLEEVE 63', 18, 214, 'end');
  return raw(`<svg class="flat flat--annotated" viewBox="-70 0 520 480" role="img" aria-label="Overshirt technical flat with points of measure">${GARMENTS.overshirt.front}${dims}</svg>`);
}

module.exports = { flat, annotatedFlat };
