LD57 - Depths
============================

Ludum Dare 57 Entry by Jimbly - "TBD"

* Play here: [dashingstrike.com/LudumDare/LD57/](http://www.dashingstrike.com/LudumDare/LD57/)
* Using [Javascript libGlov/GLOV.js framework](https://github.com/Jimbly/glovjs)

Acknowledgements:
* TODO

Start with: `npm start` (after running `npm i` once)

Polish:
* If there are 2 or fewer white remaining after clearing, give a new board? (and don't shouldConsume on non-white)
  * Conservation of white and try to remove 100% / some quota to get new board?  Nice that clearing waste gives more options though
* Tap-select-tap-swap controls

Plan
* Similar to distilling in YPP
* turn based, single undo
* when (left) column is consumed, miner moves right
* if it's all white, miner also moves down
* stretch: if it's all black/brown, gain a protection; if any white is wasted, move up
* Goal:
  * reach a depth of 12 in a minimum number of consumptions
