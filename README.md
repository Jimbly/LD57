LD57 - Depths
============================

Ludum Dare 57 Entry by Jimbly - "Refinerator"

* Play here: [dashingstrike.com/LudumDare/LD57/](http://www.dashingstrike.com/LudumDare/LD57/)
* Using [Javascript libGlov/GLOV.js framework](https://github.com/Jimbly/glovjs)

Acknowledgements:
* [BGB Gameboy Palette](https://lospec.com/palette-list/nintendo-gameboy-bgb)
* [04b03 Font](https://www.dafont.com/04b-03.font)

Start with: `npm start` (after running `npm i` once)

TODO / Polish
* Animate in the initial board
* Tap-select-tap-swap controls

Plan
* Similar to distilling in YPP
* turn based, single undo
* when (left) column is consumed, miner moves right
* if it's all white, miner also moves down
* stretch: if it's all black/brown, gain a protection; if any white is wasted, move up
* Goal:
  * reach a depth of 12 in a minimum number of consumptions

Sound banks:
00 - button press - speed 0x50
03 - rollover (Second) - speed 0x80
07 - consume_okay - speed 0x80
08 - consume_bad - speed 0x80
02 - consume_good melody + consume_okay - speed 0x50

01/03 - up1-8 - speed 0x20
09/0A - down1-8 - speed 0x20