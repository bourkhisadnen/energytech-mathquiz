/* Structural checks on the PDF radio groups the worksheet exports.
 *
 * These exist because of a bug that only ever showed on Android. Selecting a
 * second option left the first one filled; you could end up with all four lit.
 *
 * The cause was a single stray key. Each widget annotation declared /FT/Btn on
 * itself. /FT is inheritable and the parent field carried /FT/Btn plus
 * /Ff 49152, so the file was legal and desktop Acrobat read it correctly --
 * it resolves the parent's /Kids and treats the four as one radio group.
 * Acrobat on Android classifies each annotation locally, saw /FT on the
 * annotation, and read it as a field in its own right rather than a kid.
 * Four independent fields, four independent /AS values.
 *
 * Establishing that took three wrong guesses, so the conclusion is recorded
 * here as fact rather than reasoning: a test PDF was built with four blocks,
 * each a different structure, and run on the actual tablet.
 *
 *   kid has /FT and /Ff        -> broken (a radio group of one, and with
 *                                 NoToggleToOff set it latches on)
 *   kid has /FT only           -> broken (this was the original build)
 *   kid has neither            -> WORKS
 *   kid has neither, /Opt on parent -> works too, /Opt is not required
 *   hyperref \ChoiceMenu       -> broken
 *
 * So the rule these assertions defend: the kid must be a pure widget
 * annotation. Every field-level key belongs on the parent and nowhere else.
 * Adding /FT back "for clarity" reintroduces the bug, silently, on a device
 * nobody tests on by default.
 *
 * Wire-up: point the input at whatever your suite already uses to build a
 * paper's .tex. Everything below takes that string.
 */

/* ------------------------------------------------------------------ */

const MIN_HIT_WIDTH_BP = 20; // ~7.1mm
const MIN_HIT_HEIGHT_BP = 13; // ~4.6mm, capped by the gap between options
const RADIO_FLAGS = 49152; // bit 15 NoToggleToOff + bit 16 Radio

function assert(cond, message) {
  if (!cond) throw new Error('radio structure: ' + message);
}

function widgetMacro(tex) {
  const m = tex.match(/\\newcommand\\ws@widget\[1\]\{[\s\S]*?\n\}/);
  assert(m, '\\ws@widget macro not found in the generated LaTeX');
  return m[0];
}

function annotBody(widget) {
  const m = widget.match(/\\pdfannot[^{]*\{([\s\S]*?)\n\s*\}%/);
  assert(m, 'could not read the annotation dictionary out of \\ws@widget');
  return m[1];
}

function annotDims(widget) {
  const m = widget.match(
    /\\pdfannot\s+width\s+([\d.]+)bp\s+height\s+([\d.]+)bp\s+depth\s+([\d.]+)bp/
  );
  assert(m, '\\pdfannot width/height/depth not found on the widget');
  return {
    width: parseFloat(m[1]),
    height: parseFloat(m[2]) + parseFloat(m[3])
  };
}

function graderJs(tex) {
  const m = tex.match(
    /\\begin\{filecontents\*\}\[overwrite\]\{etgrader\.js\.dat\}([\s\S]*?)\\end\{filecontents\*\}/
  );
  assert(m, 'the etgrader.js.dat block was not found in the generated LaTeX');
  return m[1];
}

function fnBody(js, name) {
  const m = js.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  assert(m, name + ' not found in the grader script');
  return m[0];
}

function appearanceBBoxes(tex) {
  const out = [];
  const re = /\/Type\/XObject\/Subtype\/Form\/BBox\[([\d.\s]+)\]/g;
  let m;
  while ((m = re.exec(tex)) !== null) {
    const n = m[1].trim().split(/\s+/).map(Number);
    out.push({ width: n[2] - n[0], height: n[3] - n[1] });
  }
  return out;
}

/* ------------------------------------------------------------------ */

const CHECKS = {
  'widget declares no /FT': function (tex) {
    assert(
      !/\/FT\s*\/?\w*/.test(annotBody(widgetMacro(tex))),
      '/FT is back on the widget annotation. Acrobat on Android reads that as ' +
        'a field in its own right rather than a kid of the radio group, and ' +
        'all four options can then be selected at once. Verified on device.'
    );
  },

  'widget declares no /Ff': function (tex) {
    assert(
      !/\/Ff\b/.test(annotBody(widgetMacro(tex))),
      '/Ff is on the widget annotation. With /FT present this makes each ' +
        'option a radio group of one, and NoToggleToOff then latches it on ' +
        'permanently. Field flags belong on the parent only.'
    );
  },

  'widget points at its parent': function (tex) {
    assert(
      /\/Parent\s+\\ws@parent/.test(annotBody(widgetMacro(tex))),
      'the widget no longer references \\ws@parent, so nothing groups the ' +
        'four options together'
    );
  },

  'parent field carries the radio flags': function (tex) {
    const m = tex.match(/<<\/FT\/Btn\/Ff\s+(\d+)\/T\(Q/);
    assert(m, 'parent radio field object not found');
    assert(
      Number(m[1]) === RADIO_FLAGS,
      'parent /Ff is ' + m[1] + ', expected ' + RADIO_FLAGS +
        ' (Radio + NoToggleToOff)'
    );
  },

  'widget carries an /AP with an /Off state and a per-option on state': function (tex) {
    assert(
      /\/AP<<\/N<<\/Off\s+\\ws@apoff\s*\/#1\s+\\ws@apon>>>>/.test(widgetMacro(tex)),
      'widget /AP is not the expected /Off + /#1 pair; the on-state must vary ' +
        'per option or one value lights every button in the group'
    );
  },

  'the on state is driven by a counter that steps per option': function (tex) {
    assert(
      /\\ws@widget\{\\alph\{wsopt\}\}/.test(tex),
      'the widget on-state is no longer \\alph{wsopt}; four options could ' +
        'end up sharing one on-state name'
    );
    assert(
      /\\stepcounter\{wsopt\}/.test(tex),
      '\\opt no longer steps wsopt, so options would share an on-state name'
    );
    assert(
      /\\setcounter\{wsopt\}\{0\}/.test(tex),
      'wsopt is never reset, so option letters would run on across questions'
    );
  },

  'hit area is big enough for a fingertip': function (tex) {
    const d = annotDims(widgetMacro(tex));
    assert(
      d.width >= MIN_HIT_WIDTH_BP,
      'hit area is ' + d.width + 'bp wide, want at least ' + MIN_HIT_WIDTH_BP
    );
    assert(
      d.height >= MIN_HIT_HEIGHT_BP,
      'hit area is ' + d.height + 'bp tall, want at least ' + MIN_HIT_HEIGHT_BP
    );
  },

  'appearance BBox matches the hit area so the circle stays round': function (tex) {
    const d = annotDims(widgetMacro(tex));
    const boxes = appearanceBBoxes(tex);
    assert(boxes.length >= 2, 'expected at least two Form XObject BBoxes (off and on)');
    boxes.slice(0, 2).forEach(function (b, i) {
      const which = i === 0 ? 'off' : 'on';
      assert(
        b.width === d.width && b.height === d.height,
        'the ' + which + ' appearance BBox is ' + b.width + 'x' + b.height +
          ' but /Rect is ' + d.width + 'x' + d.height +
          '; the stream is scaled onto the rect, so the circle would distort'
      );
    });
  },

  'widget does not carry /MK or /BS': function (tex) {
    const w = widgetMacro(tex);
    assert(
      !/\/MK</.test(w),
      '/MK is back on the widget. It describes a background and border for the ' +
        'whole /Rect, which a viewer paints when it constructs an appearance -- ' +
        'at this rect size that is a box drawn around every option.'
    );
    assert(
      !/\/BS</.test(w),
      '/BS is back on the widget; same problem as /MK at this rect size.'
    );
  },

  'the wide annotation contributes no width to the line': function (tex) {
    assert(
      /\\makebox\[13bp\]\[l\]\{\\(?:smash\{\\)?rlap\{\\ws@widget/.test(tex),
      'the widget is wider than its 13bp makebox and is no longer wrapped in ' +
        '\\rlap, so every option row will report an overfull hbox'
    );
  },

  'the grader script never references console': function (tex) {
    const js = graderJs(tex);
    const hit = js.match(/^.*\bconsole\s*\..*$/m);
    assert(
      !hit,
      'the grader script references console: ' + (hit ? hit[0].trim() : '') +
        '\n        There is no console object in Acrobat on Android. Inside a ' +
        'catch handler it throws in turn, that exception escapes the catch, ' +
        'and the enclosing loop dies. This is what left the mastery table with ' +
        'only its first cell filled.'
    );
  },

  'mastery colour is guarded separately from the mastery value': function (tex) {
    const fn = fnBody(graderJs(tex), 'etMastery');
    const valueIdx = fn.indexOf('f.value');
    const colourIdx = fn.indexOf('f.fillColor');
    assert(valueIdx !== -1 && colourIdx !== -1, 'etMastery no longer sets both value and fillColor');
    const between = fn.slice(valueIdx, colourIdx);
    assert(
      /catch\s*\([^)]*\)\s*\{/.test(between),
      'etMastery sets f.value and f.fillColor inside the same try block. ' +
        'fillColor throws on Acrobat for Android, so the cell would keep its ' +
        'number only by luck of ordering. They need separate guards.'
    );
  },

  /* Guarding the four property writes in etClearMastery did not fix "Clear
   * all" stopping after the first mastery cell on a real device, and routing
   * every field lookup through this guarded wrapper (etField, tried next)
   * did not either -- a second scoring run proved doc.getField itself is
   * fine even on a field script already wrote to once, which is what this
   * wrapper was guarding against. Both are RULED OUT causes now, not
   * suspects. etField is kept anyway: it is a harmless guard around a real
   * platform call, and removing it buys nothing back. See
   * claude/30-worksheet-radio-buttons-on-android.md for what is still live. */
  'mastery and answer lookups go through the guarded getField wrapper': function (tex) {
    const js = graderJs(tex);
    assert(
      /function\s+etField\s*\(/.test(js),
      'etField (a guarded wrapper around doc.getField) is no longer defined ' +
        'in the grader script'
    );
    ['etPick', 'etMastery', 'etClearMastery'].forEach(function (name) {
      const fn = fnBody(js, name);
      assert(
        !/\bdoc\s*\.\s*getField\s*\(/.test(fn),
        name + ' calls doc.getField directly instead of etField.'
      );
      assert(
        /\betField\s*\(/.test(fn),
        name + ' no longer looks up a field at all -- was etField removed ' +
          'along with the lookup, not just renamed?'
      );
    });
  },

  /* Neither the write-guard fix nor the getField wrapper above changed the
   * device result, and a second scoring run proved etMastery's own loop is
   * fine on an already-written field -- ruling out both "a write throws"
   * and "getField is unreliable on a touched field". The one thing left
   * that etClearMastery does differently from a plain etMastery run is
   * execute in the same action as a doc.resetForm() call. This pins the one
   * untried variable: the mastery loop must run BEFORE resetForm, not after,
   * so nothing about resetForm's own aftermath runs ahead of it. */
  'mastery cells are cleared before resetForm runs, not after': function (tex) {
    const fn = fnBody(graderJs(tex), 'etReset');
    const clearIdx = fn.indexOf('etClearMastery(');
    const resetIdx = fn.indexOf('resetForm(');
    assert(clearIdx !== -1, 'etReset no longer calls etClearMastery');
    assert(resetIdx !== -1, 'etReset no longer calls doc.resetForm');
    assert(
      clearIdx < resetIdx,
      'etClearMastery runs after doc.resetForm() again. On a real device ' +
        '"Clear all" stopped after the first mastery cell with mastery ' +
        'cleared second; running it first is the untried ordering -- see ' +
        'claude/30-worksheet-radio-buttons-on-android.md.'
    );
  },

  'NeedAppearances is switched off': function (tex) {
    assert(
      /\\begin\{Form\}\[[^\]]*NeedAppearances\s*=\s*false/.test(tex),
      'NeedAppearances is back on. hyperref turns it on for every Form ' +
        'environment, and it tells a viewer to disregard the appearance ' +
        'streams in the file and draw its own mark, centred in the widget ' +
        "rectangle. With the rect now 26bp wide, centred is 13bp right of " +
        'the authored circle -- the filled dot lands on the option letter, ' +
        'and unselected options vanish because there is no /MK to build an ' +
        'off state from. Verified on a PC.'
    );
  },

  'every question still emits four options': function (tex) {
    // Was split on \setcounter{wsopt}{0}, which only ever appears ONCE in the
    // generated LaTeX -- inside \newenvironment{wsq}'s definition, not once
    // per invocation. LaTeX re-runs that reset on every \begin{wsq} at compile
    // time, but as literal text in the .tex it never repeats, so the old split
    // lumped every question's options into one bucket. \begin{wsq} itself
    // (one real per-question marker) is what actually recurs in the text.
    const questions = tex.split(/\\begin\{wsq\}/).slice(1);
    assert(questions.length > 0, 'no questions found in the generated LaTeX');
    questions.forEach(function (q, i) {
      const n = (q.match(/\\opt\{/g) || []).length;
      assert(n === 4, 'question ' + (i + 1) + ' emitted ' + n + ' options, expected 4');
    });
  }
};

/* ------------------------------------------------------------------ */

function runRadioStructureChecks(tex) {
  const failures = [];
  Object.keys(CHECKS).forEach(function (name) {
    try {
      CHECKS[name](tex);
    } catch (err) {
      failures.push('  FAIL  ' + name + '\n        ' + err.message);
    }
  });
  if (failures.length) {
    throw new Error(
      failures.length + ' of ' + Object.keys(CHECKS).length +
        ' radio structure checks failed:\n' + failures.join('\n')
    );
  }
  return Object.keys(CHECKS).length;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runRadioStructureChecks: runRadioStructureChecks, CHECKS: CHECKS };
}