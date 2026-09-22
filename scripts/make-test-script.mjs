/**
 * Builds a synthetic screenplay PDF with a real text layer, and a scanned-style
 * PDF with none, so the private path can be tested without shipping a script
 * into the repo.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

const SCENES = [
  {
    heading: "INT. AMBULANCE BAY - NIGHT",
    action:
      "MARA VOSS, late thirties, unhurried in a way that reads as either calm or contempt, backs a rig into a space it does not fit.",
    lines: [
      ["MARA", "Tell them the bay was blocked. Tell them I said it politely."],
      ["OTIS", "You want me to lie to a supervisor on a Tuesday."],
      ["MARA", "I want you to say the bay was blocked, which it was, by a supervisor."],
    ],
    closer: "She kills the engine and sits for a moment before getting out.",
  },
  {
    heading: "INT. HOSPITAL CORRIDOR - CONTINUOUS",
    action:
      "DEVLIN PARK, forties, a man who irons things, walks with a clipboard held like a shield.",
    lines: [
      ["DEVLIN", "There is a process for this and you have never once used it."],
      ["MARA", "The process takes nine minutes. He had four."],
      ["DEVLIN", "That is not the point I am making and you know it."],
      ["MARA", "Then make a better one, Devlin."],
    ],
    closer: "DEVLIN watches her go, then writes something on the clipboard.",
  },
  {
    heading: "EXT. PARKING STRUCTURE - LATER",
    action: "Rain. NURSE PELL, twenties, smokes under a sign forbidding it.",
    lines: [
      ["NURSE PELL", "You are going to get written up."],
      ["MARA", "I am going to get coffee."],
      ["NURSE PELL", "Those are the same sentence around here."],
    ],
    closer: "Rain runs off the awning in a sheet.",
  },
  {
    heading: "INT. DISPATCH - NIGHT",
    action: "Screens. Coffee rings. OTIS BRAND, sixty, eats a sandwich with total focus.",
    lines: [
      ["OTIS", "Twenty-two years and nobody has ever thanked me for a shortcut."],
      ["MARA", "I will thank you when it works."],
      ["OTIS", "It always works. That is what makes it a shortcut."],
      ["DEVLIN", "I would like that on the record."],
    ],
    closer: "OTIS BRAND wipes his hands on a napkin and turns back to the screens.",
  },
  {
    // Small parts, so tier assignment is actually exercised: with only leads in
    // the fixture every role came back LEAD and a DAY PLAYER bug would pass.
    heading: "INT. ALL NIGHT DINER - LATER",
    action:
      "A tired room. WALT the COOK, sixties, scrapes the grill. A BARMAN leans on the counter. A TOW TRUCK DRIVER eats alone.",
    lines: [
      ["WALT", "Kitchen closes in ten whether you are eating or not."],
      ["BARMAN", "He has been saying that since nine."],
      ["TOW TRUCK DRIVER", "Rig out front is mine. Nobody touch it."],
      ["MARA", "Nobody wants it."],
    ],
    closer: "WALT turns the sign to CLOSED and keeps cooking anyway.",
  },
  {
    heading: "EXT. HIGHWAY - PRE-DAWN",
    action: "The rig moves fast through empty lanes.",
    lines: [
      ["MARA", "Call it in when we cross the county line. Not before."],
      ["OTIS", "And if they ask where we are?"],
      ["MARA", "Tell them we are exactly where we said we would be."],
    ],
    closer: "The rig crosses a bridge as the sky goes grey.",
  },
];

// Real screenplay margins on a 612pt page: action at 1.5", dialogue at 2.5",
// character cue at 3.7". The parser reads these to tell elements apart, so a
// test PDF that draws everything at one margin would not exercise it.
const ACTION_X = 108;
const DIALOGUE_X = 180;
const CUE_X = 266;

function pageLines(scene) {
  const out = [
    { text: scene.heading, x: ACTION_X },
    { text: scene.action, x: ACTION_X },
  ];
  for (const [cue, line] of scene.lines) {
    out.push({ text: cue, x: CUE_X });
    out.push({ text: line, x: DIALOGUE_X });
  }
  // An action line immediately after a speech, with no blank line between —
  // the case that used to leak into the speech and come back as a description.
  out.push({ text: scene.closer, x: ACTION_X });
  return out;
}

export async function makeScreenplayPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);

  for (const scene of SCENES) {
    const page = pdf.addPage([612, 792]);
    let y = 720;
    for (const line of pageLines(scene)) {
      // pdf-lib throws on characters Courier cannot encode.
      const safe = line.text.replace(/[^\x20-\x7E]/g, "-");
      page.drawText(safe, { x: line.x, y, size: 11, font });
      y -= 16;
    }
  }

  return Buffer.from(await pdf.save());
}

/** A PDF with no text layer at all — what a scanned script looks like. */
export async function makeScannedPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  return Buffer.from(await pdf.save());
}

/**
 * A second fixture, built to fail the way real scripts fail.
 *
 * The screenplay above is a clean one: every character is introduced in an
 * action line that says who they are, and almost nothing else names them. It
 * cannot reproduce anything that has gone wrong on this path — run the evidence
 * inspector over it and every role looks perfect, which is exactly how a fixture
 * misleads you.
 *
 * This one carries the four shapes a 147-page feature actually produced:
 *
 *   RENNA  — introduced properly on page 1, then named in two dozen blocking
 *            lines. The introduction survives; everything after it is movement.
 *   HOLT   — first named in a blocking line, described only on page 9. The six
 *            lines taken are all from before that, so the one line that says who
 *            he is never reaches the model.
 *   SIKE   — speaks throughout and is never named in an action line at all. No
 *            description evidence exists for him in any quantity.
 *   BARMAN — a generic cue name. The word appears on page 1 about a different,
 *            unnamed man; the character himself turns up on page 10 and is never
 *            named in action. His entire evidence is about somebody else.
 *
 * Everything here is written for this repository. No script text is reproduced.
 */
const BLOCKING_SCENES = [
  {
    heading: "INT. THE LOCKUP - NIGHT",
    items: [
      ["action", "RENNA, thirty-four, hard through the shoulders from ten years of hauling other people's freight, shoulders the roller door up."],
      ["action", "HOLT drags the gate shut behind her and throws the bolt."],
      ["action", "A BARMAN two doors down is hosing off the footpath, uninterested."],
      ["cue", "RENNA"],
      ["dialogue", "Count them before you tell me the number."],
      ["cue", "HOLT"],
      ["dialogue", "I counted them twice on the way in."],
      ["action", "RENNA crosses to the shelving and starts on the far crates."],
      ["action", "HOLT stays by the door with his hands in his pockets."],
    ],
  },
  {
    heading: "INT. THE LOCKUP - LATER",
    items: [
      ["action", "RENNA works down the row, marking each lid with a wax pencil."],
      ["cue", "RENNA"],
      ["dialogue", "Forty on the manifest. Thirty-six on the floor."],
      ["cue", "HOLT"],
      ["dialogue", "Then the manifest is wrong, because I was here."],
      ["action", "HOLT takes the clipboard off the hook and holds it out."],
      ["action", "RENNA does not take it. She goes back to the crates."],
    ],
  },
  {
    heading: "EXT. LOADING DOCK - DAWN",
    items: [
      ["action", "RENNA sits on the edge of the dock with her boots hanging."],
      ["action", "HOLT comes out with two cups and puts one down beside her."],
      ["cue", "HOLT"],
      ["dialogue", "You can walk away from this one. Nobody would say anything."],
      ["cue", "RENNA"],
      ["dialogue", "Somebody would say something. That is the whole business."],
      ["action", "RENNA drinks and watches the gulls work the water."],
    ],
  },
  {
    heading: "INT. DISPATCH OFFICE - DAY",
    items: [
      ["action", "A room with one window and too many chairs for it."],
      ["cue", "SIKE"],
      ["dialogue", "The run sheets came back short again. Third week."],
      ["cue", "RENNA"],
      ["dialogue", "Short is a word people use when they mean taken."],
      ["action", "RENNA pulls the drawer out and tips the sheets onto the desk."],
      ["cue", "SIKE"],
      ["dialogue", "I am not going to be the one who writes that down."],
      ["action", "HOLT reads over her shoulder without touching anything."],
    ],
  },
  {
    heading: "EXT. YARD - DAY",
    items: [
      ["action", "RENNA walks the fence line and stops where the wire is cut."],
      ["action", "HOLT crouches and puts two fingers through the gap."],
      ["cue", "HOLT"],
      ["dialogue", "Somebody came in the easy way and left the hard way."],
      ["cue", "RENNA"],
      ["dialogue", "Or they left the way they came and we are slow."],
      ["action", "RENNA photographs the cut, then the ground under it."],
    ],
  },
  {
    heading: "INT. BACK CORRIDOR - NIGHT",
    items: [
      ["action", "RENNA moves along the wall with the torch held low."],
      ["cue", "SIKE"],
      ["dialogue", "There is a door at the end that nobody has a key for."],
      ["action", "HOLT tries the handle anyway and it turns."],
      ["cue", "RENNA"],
      ["dialogue", "That is worse than locked."],
      ["action", "RENNA goes through first and HOLT follows her in."],
    ],
  },
  {
    heading: "INT. COLD STORE - CONTINUOUS",
    items: [
      ["action", "RENNA breathes out and watches it hang in the air."],
      ["action", "HOLT pulls the chain and the bulb does nothing."],
      ["cue", "RENNA"],
      ["dialogue", "Prop it. If it shuts on us we are here until Monday."],
      ["cue", "HOLT"],
      ["dialogue", "It is a Thursday. Somebody would come."],
      ["action", "RENNA wedges the door with a crate and goes deeper in."],
    ],
  },
  {
    heading: "INT. COLD STORE - LATER",
    items: [
      ["action", "RENNA finds the pallet that does not match the others."],
      ["action", "HOLT gets the corner up and they both look at what is under it."],
      ["cue", "RENNA"],
      ["dialogue", "Put it back exactly how it was."],
      ["cue", "HOLT"],
      ["dialogue", "And then what, we go home and sleep."],
      ["action", "RENNA sets the corner down and wipes the dust back over it."],
    ],
  },
  {
    heading: "INT. HOLT'S OFFICE - NIGHT",
    items: [
      ["action", "HOLT, fifty, a wrestler's neck gone soft and a voice that never once rises, sets the ledger down and squares it to the desk edge."],
      ["cue", "HOLT"],
      ["dialogue", "I have signed every one of these for nine years."],
      ["cue", "RENNA"],
      ["dialogue", "I know. That is what I keep getting stuck on."],
      ["action", "RENNA stays standing. HOLT does not ask her to sit."],
    ],
  },
  {
    heading: "INT. THE ANCHOR - NIGHT",
    items: [
      ["action", "A narrow bar with the television on and nobody watching it."],
      ["cue", "BARMAN"],
      ["dialogue", "He has been in that seat since I opened."],
      ["cue", "RENNA"],
      ["dialogue", "Has he been drinking since you opened."],
      ["cue", "BARMAN"],
      ["dialogue", "He has been sitting. There is a difference and I respect it."],
      ["action", "RENNA takes the stool at the end and orders nothing."],
    ],
  },
  {
    heading: "EXT. CAR PARK - NIGHT",
    items: [
      ["action", "RENNA sits in the car with the keys in her hand and does not start it."],
      ["cue", "SIKE"],
      ["dialogue", "You are going to ask me to say it in a room with a recorder."],
      ["cue", "RENNA"],
      ["dialogue", "I am going to ask you once and then not again."],
      ["action", "RENNA starts the engine. HOLT watches from the doorway."],
    ],
  },
  {
    heading: "INT. THE LOCKUP - DAWN",
    items: [
      ["action", "RENNA rolls the door up on an empty floor."],
      ["action", "HOLT is already inside, sitting on an upturned crate."],
      ["cue", "HOLT"],
      ["dialogue", "You were right about the manifest."],
      ["cue", "RENNA"],
      ["dialogue", "I would rather have been slow."],
      ["action", "RENNA sits down on the crate opposite him and they wait."],
    ],
  },
];

/**
 * The same layout as makeScreenplayPdf, but with the element order given per
 * line instead of assumed, because the failures above are about which action
 * lines fall where.
 */
async function drawElementPdf(scenes) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  const X = { action: ACTION_X, cue: CUE_X, dialogue: DIALOGUE_X };

  for (const scene of scenes) {
    const page = pdf.addPage([612, 792]);
    let y = 720;
    const rows = [["action", scene.heading], ...scene.items];
    for (const [kind, text] of rows) {
      const safe = text.replace(/[^\x20-\x7E]/g, "-");
      page.drawText(safe, { x: X[kind], y, size: 11, font });
      y -= 16;
    }
  }

  return Buffer.from(await pdf.save());
}

/**
 * A movement-heavy screenplay whose look line sits past the old cap of six.
 *
 * Written for this repository. Calder is named in blocking from the first
 * scene — hauling rope, crossing the deck, climbing into the hold — and is
 * not described until the wheelhouse, his eighth action mention. The previous
 * selector kept the first six mentions and stopped, so the evidence was six
 * blocking lines: look 0. An intro-first classifier made that look even worse,
 * because every selected line contains the caps name and was therefore counted
 * as an introduction: look 0, moves 0.
 *
 * Vess is the control. She is introduced on page 1 with hair, a coat, and an
 * age, then named in blocking after that. Her introduction has to survive the
 * same selector that reaches back for Calder.
 */
const MOVEMENT_SCENES = [
  {
    heading: "INT. DECK - NIGHT",
    items: [
      ["action", "CALDER hauls the rope over the cleat and kicks the hatch shut."],
      ["action", "VESS, twenty-eight, rain-dark hair and a thin coat, drops onto the deck."],
      ["cue", "VESS"],
      ["dialogue", "You left the hatch open on a falling tide."],
      ["cue", "CALDER"],
      ["dialogue", "I left it open so I could see the water."],
      ["action", "CALDER crosses the deck and checks the winch."],
      ["action", "VESS follows him and stays clear of the rope."],
    ],
  },
  {
    heading: "EXT. BOW - CONTINUOUS",
    items: [
      ["action", "CALDER drops to one knee and works the knot loose."],
      ["action", "VESS crosses to the rail and points at the channel marker."],
      ["cue", "VESS"],
      ["dialogue", "That light is not where it was an hour ago."],
      ["cue", "CALDER"],
      ["dialogue", "Then we are drifting, or it is."],
      ["action", "CALDER stands and walks the line back toward the bow."],
      ["action", "VESS climbs the ladder two rungs at a time."],
    ],
  },
  {
    heading: "INT. HOLD - NIGHT",
    items: [
      ["action", "CALDER climbs down into the hold and starts on the crates."],
      ["action", "VESS stays on the ladder with the torch aimed down."],
      ["cue", "CALDER"],
      ["dialogue", "The count is off before we have even left the dock."],
      ["cue", "VESS"],
      ["dialogue", "Off against whose list, Calder."],
      ["action", "CALDER shoves a crate until it meets the stack."],
      ["action", "VESS comes down the rest of the way and does not touch them."],
    ],
  },
  {
    heading: "INT. WHEELHOUSE - LATER",
    items: [
      ["action", "CALDER leans on the chart table and taps the pencil once."],
      ["action", "VESS shuts the door behind her and waits."],
      ["cue", "VESS"],
      ["dialogue", "Say what you would not say on deck."],
      ["cue", "CALDER"],
      ["dialogue", "The count was off last week too. I signed it anyway."],
      ["action", "CALDER, early forties, a burn scar on the jaw, voice kept flat."],
      ["action", "VESS watches his hands, which stay still while he talks."],
    ],
  },
  {
    heading: "EXT. DECK - PRE-DAWN",
    items: [
      ["action", "CALDER folds the chart and switches the radio off."],
      ["action", "VESS takes the pencil he set down and puts it back."],
      ["cue", "CALDER"],
      ["dialogue", "We go at first light. Not before."],
      ["cue", "VESS"],
      ["dialogue", "Then sleep. I will wake you when the tide turns."],
      ["action", "CALDER nods once and leaves the lamp burning."],
      ["action", "VESS stays at the wheel and does not sit."],
    ],
  },
];

export async function makeMovementPdf() {
  return drawElementPdf(MOVEMENT_SCENES);
}

export async function makeBlockingPdf() {
  return drawElementPdf(BLOCKING_SCENES);
}
