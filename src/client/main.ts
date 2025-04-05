/* eslint n/global-require:off */
// eslint-disable-next-line import/order
const local_storage = require('glov/client/local_storage');
local_storage.setStoragePrefix('ld57'); // Before requiring anything else that might load from this

const GAME_OVER = 25;
const VICTORY = 12;

import assert from 'assert';
import { autoAtlas } from 'glov/client/autoatlas';
import { platformParameterGet } from 'glov/client/client_config';
import * as engine from 'glov/client/engine';
import { ALIGN, fontStyle, vec4ColorFromIntColor } from 'glov/client/font';
import { Box } from 'glov/client/geom_types';
import {
  eatAllInput,
  keyDownEdge,
  KEYS,
  mouseDownAnywhere,
  mouseDownEdge,
  mousePos,
} from 'glov/client/input';
import { netInit } from 'glov/client/net';
import { spot, SPOT_DEFAULT_BUTTON } from 'glov/client/spot';
import { spriteSetGet } from 'glov/client/sprite_sets';
import { spriteClipPop, spriteClipPush } from 'glov/client/sprites';
import {
  buttonImage,
  drawHBox,
  drawRect,
  scaleSizes,
  setButtonHeight,
  setFontHeight,
  uiButtonHeight,
  uiGetFont,
  uiTextHeight,
} from 'glov/client/ui';
import { randCreate, shuffleArray } from 'glov/common/rand_alea';
import { TSMap } from 'glov/common/types';
import { clone, easeIn, easeInOut, easeOut, lerp, ridx, tweenBounceOut } from 'glov/common/util';
import {
  JSVec2,
  v2dist,
  vec2,
  vec4,
} from 'glov/common/vmath';

const palette_font = [
  0x081820ff,
  0x346856ff,
  0x88c070ff,
  0xe0f8d0ff,
];
const palette = palette_font.map((c) => {
  return vec4ColorFromIntColor(vec4(), c);
});

const { abs, max, min, floor, sin, PI } = Math;

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.SPRITES = 10;

// Virtual viewport for our game logic
const game_width = 128;
const game_height = 128;

const COLUMNS = 7;
const ROWS_TALL = 6;
const ROWS_SHORT = ROWS_TALL - 1;

let rand = randCreate(1234);

function moves(a: number, b: number, up: boolean): boolean {
  if (!up) {
    let t = a;
    a = b;
    b = t;
  }
  return a === 1 && b === 3 ||
    a === 3 && b === 2 ||
    a === 2 && b === 1;
}

class GameState {
  columns: number[][];
  held: JSVec2 | null = null;
  first_column_is_high = true;
  count_bad = 0;
  count_good = 0;

  queue: number[] = [];
  orb(): number {
    let { queue } = this;
    if (!queue.length) {
      for (let ii = 1; ii <= 3; ++ii) {
        for (let jj = 0; jj < 40; ++jj) {
          queue.push(ii);
        }
      }
      shuffleArray(rand, queue);
    }
    return queue.pop()!;
  }

  constructor() {
    this.columns = [];
    for (let ii = 0; ii < COLUMNS; ++ii) {
      let row = [];
      for (let jj = 0; jj < (ii % 2 ? ROWS_SHORT : ROWS_TALL); ++jj) {
        row.push(this.orb());
      }
      this.columns.push(row);
    }
  }

  canSwap(b: JSVec2): boolean {
    let a = this.held!;
    let ax = a[0];
    let ay = a[1] * 2 + (this.columns[ax].length === ROWS_SHORT ? 1 : 0);
    let bx = b[0];
    let by = b[1] * 2 + (this.columns[bx].length === ROWS_SHORT ? 1 : 0);
    if (abs(ax - bx) !== 1) {
      return false;
    }
    if (abs(ay - by) !== 1) {
      return false;
    }
    let ca = this.columns[ax][a[1]];
    let cb = this.columns[bx][b[1]];
    return moves(ca, cb, by < ay);
  }
  swap(b: JSVec2): void {
    let a = this.held!;
    let t = this.columns[a[0]][a[1]];
    this.columns[a[0]][a[1]] = this.columns[b[0]][b[1]];
    this.columns[b[0]][b[1]] = t;
    this.held = b;
  }
  consume(move: 'auto' | 'down'): ['both'|'right', string, number[]] {
    this.last_columns = null;
    let counts = [0,0,0,0];
    let column = this.columns[0];
    for (let ii = 0; ii < column.length; ++ii) {
      counts[column[ii]]++;
    }
    let count_white = counts[1];

    this.columns.splice(0, 1);
    let new_column = [];
    for (let ii = 0; ii < (column.length === ROWS_TALL ? ROWS_SHORT : ROWS_TALL); ++ii) {
      new_column.push(this.orb());
    }
    this.columns.push(new_column);

    let result: 'both' | 'right' = 'right';
    let msg;
    if (count_white === column.length || move === 'down') {
      msg = 'Perfect!';
      result = 'both';
      this.count_good++;
      //this.count_bad++;
    } else {
      this.count_bad++;
      if (count_white) {
        this.count_bad++;
        msg = 'Impure!';
      } else {
        msg = 'Waste removed';
      }
    }

    let row = [];
    if (result === 'both') {
      for (let ii = 0; ii < this.columns.length; ++ii) {
        let col = this.columns[ii];
        row.push(col.shift()!);
        col.push(this.orb());
      }
    }

    return [result, msg, row];
  }

  shouldConsume(): boolean {
    let c0 = this.columns[0];
    let all_white = true;
    let all_other = true;
    for (let ii = 0; ii < c0.length; ++ii) {
      if (c0[ii] === 1) {
        all_other = false;
      } else {
        all_white = false;
      }
    }
    return all_white || all_other;
  }

  last_columns: null | number[][] = null;
  did_save_state = false;
  saveState(): void {
    this.last_columns = clone(this.columns);
    this.did_save_state = true;
  }

  undo(): void {
    if (this.last_columns) {
      this.columns = this.last_columns;
      this.last_columns = null;
    }
  }
}

let game_state: GameState;
function init(): void {
  game_state = new GameState();
}

const ORB_DIM = 8;
const ORB_XPAD = 1;
const ORB_YPAD = 2;
const XADV = ORB_DIM + ORB_XPAD;
const YADV = ORB_DIM + ORB_YPAD;
const BOARD_X = floor((game_width - (ORB_DIM * COLUMNS + ORB_XPAD * (COLUMNS - 1))) / 2);
const BOARD_Y = floor((game_height - (ORB_DIM * ROWS_TALL + ORB_YPAD * (ROWS_TALL - 1))) / 2);
const BOARD_Y1 = BOARD_Y + YADV * 6 - ORB_YPAD;
const BOARD_X1 = BOARD_X + XADV * 7 - ORB_XPAD;

type Tween = {
  dx: number;
  dy: number;
  t: number;
};
let tweens: TSMap<Tween[]> = {};

let board_anim: null | {
  t: number;
  style: 'both' | 'right';
  column: number[];
  row: number[];
} = null;
let messages: { msg: string; t: number }[] = [];
let mouse_pos = vec2();
let idx_to_pos: Box[][] = [];
let blink = 0;
let grinder_anim_h = 0;
let grinder_anim_v = 0;
function statePlay(dt: number): void {
  gl.clearColor(palette[0][0], palette[0][1], palette[0][2], 1);
  let font = uiGetFont();

  let board_x = BOARD_X;
  let board_y = BOARD_Y;
  let frame_x = board_x - 14;
  let frame_y = board_y - 16;

  for (let ii = messages.length - 1; ii >= 0; --ii) {
    let m = messages[ii];
    m.t += dt/5000;
    if (m.t >= 1) {
      ridx(messages, ii);
      continue;
    }
    font.draw({
      color: palette_font[3],
      x: board_x + ORB_DIM/2, y: frame_y - 9 - floor(easeOut(m.t, 2) * 24),
      align: ALIGN.HCENTER,
      text: m.msg,
      z: Z.UI + 30,
    });
  }

  if (board_anim) {
    board_anim.t += dt/1000;
    if (board_anim.t >= 1) {
      board_anim = null;
    } else {
      let xoffs = XADV - floor(XADV * easeIn(board_anim.t, 2));
      board_x += xoffs;
      if (board_anim.style === 'both') {
        let yoffs = YADV - floor(YADV * board_anim.t);
        board_y += yoffs;
      }
    }
  }

  autoAtlas('gfx', 'frame').draw({
    x: frame_x,
    y: frame_y,
    w: 78,
    h: 77,
    z: Z.UI + 10,
  });

  let { count_bad, count_good } = game_state;
  if (count_bad < GAME_OVER) {
    let pixel_w = count_bad*2 + 1;
    if (board_anim && board_anim.style === 'right' && board_anim.t < 0.5) {
      --pixel_w;
    }
    pixel_w = 52 - pixel_w;
    let param = {
      x: frame_x + 25,
      y: frame_y + 4,
      w: pixel_w,
      h: 9,
      z: Z.UI + 12,
    };
    if (pixel_w < 5) {
      spriteClipPush(param.z, param.x, param.y, 10, param.h);
      param.x -= 6 - pixel_w;
      param.w = 6;
      autoAtlas('gfx', 'bar_small').draw(param);
      spriteClipPop();
    } else {
      drawHBox(param, autoAtlas('gfx', 'bar'));
    }
  }
  if (count_good === VICTORY) {
    font.draw({
      size: uiTextHeight() * 2,
      style: fontStyle(null, {
        color: palette_font[3],
        outline_color: palette_font[1],
        outline_width: 5,
      }),
      x: 0, y: 1,
      w: game_width, h: game_height,
      z: 500,
      align: ALIGN.HVCENTER,
      text: 'YOU WIN',
    });
    drawRect(game_width * 0.15, game_height * 0.4, game_width * (1 - 0.15), game_height * (1 - 0.4), 499, palette[0]);
    eatAllInput();
  }
  if (count_good) {
    let y1 = frame_y + 77 - 9;
    for (let ii = 0; ii < count_good; ++ii) {
      let y = y1 - ii * 5;
      let x = frame_x + 3;
      if (board_anim && board_anim.style === 'both' && ii === count_good - 1) {
        if (board_anim.t < 0.5) {
          continue;
        }
        let p = board_anim.t * 2 - 1;
        y = lerp(tweenBounceOut(min(1, p * (1 + ii*0.1))), BOARD_Y - 8, y);
        x = lerp(easeOut(min(1, p * 20), 2), x + 8, x);
      }
      autoAtlas('gfx', 'output').draw({
        x,
        y,
        w: 8,
        h: 5,
        z: Z.UI + 12,
      });
    }
  }

  let { columns } = game_state;
  let closest_idx: JSVec2 | null = null;
  let closest_dist = Infinity;
  mousePos(mouse_pos);

  if (board_anim && board_anim.t < 0.5) {
    let { column } = board_anim;
    let y0 = BOARD_Y + (column.length === ROWS_SHORT ? 5 : 0);
    let y = floor(y0 -
      board_anim.t * 2 * YADV * ROWS_TALL);
    for (let ii = 0; ii < column.length; ++ii) {
      let cell = column[ii];
      autoAtlas('gfx', `orb${cell}`).draw({
        x: BOARD_X,
        y: max(y, BOARD_Y - YADV - 1),
        w: ORB_DIM,
        h: ORB_DIM,
        z: Z.UI + 20 + ii * 0.01,
      });
      y += YADV;
    }
  }
  spriteClipPush(Z.UI, frame_x + 13, frame_y + 14, XADV * COLUMNS - ORB_XPAD + 2, YADV * ROWS_TALL + 1);
  if (board_anim && board_anim.row) {
    let { column, row } = board_anim;
    let y0 = board_y + (column.length === ROWS_SHORT ? 5 : 0);
    if (row) {
      let first_is_short = column.length === ROWS_TALL;
      let y = y0 - YADV - (first_is_short ? 0 : 5) - floor(easeInOut(board_anim.t, 1.5) * 16);
      let x = board_x;
      for (let ii = 0; ii < row.length; ++ii) {
        let cell = row[ii];
        autoAtlas('gfx', `orb${cell}`).draw({
          x,
          y: y + (first_is_short === Boolean(ii % 2) ? 0 : 5),
          w: ORB_DIM,
          h: ORB_DIM,
        });
        x += XADV;
      }
    }
  }

  for (let ii = 0; ii < columns.length; ++ii) {
    let column = columns[ii];
    let right = columns[ii + 1];
    let is_short = column.length === ROWS_SHORT;
    let y = board_y + (is_short ? 5 : 0);
    let pos_column = idx_to_pos[ii] = idx_to_pos[ii] || [];
    for (let jj = 0; jj < column.length; ++jj) {
      let cell = column[jj];
      let x = board_x + ii * (XADV);
      let bounds = {
        x, y,
        w: ORB_DIM,
        h: ORB_DIM,
      };
      let bounds_pre_tween: Box | null = null;
      let tween = tweens[`${ii},${jj}`];
      if (tween) {
        for (let kk = tween.length - 1; kk >= 0; --kk) {
          let elem = tween[kk];
          elem.t += dt * 0.01;
          if (elem.t >= 1) {
            ridx(tween, kk);
            continue;
          }
          if (!bounds_pre_tween) {
            bounds_pre_tween = {
              ...bounds,
            };
          }
          bounds.x += floor((1 - elem.t) * elem.dx * XADV);
          bounds.y += floor((1 - elem.t) * elem.dy * YADV / 2);
        }
      }

      pos_column[jj] = bounds;
      autoAtlas('gfx', `orb${cell}`).draw(bounds);
      let up_idx = is_short ? jj : jj - 1;
      let up = right?.[up_idx];
      let down = right?.[up_idx+1];
      if (moves(cell, up, true)) {
        autoAtlas('gfx', 'connect_up').draw({
          ...(bounds_pre_tween || bounds),
          w: 10,
        });
      }
      if (moves(cell, down, false)) {
        autoAtlas('gfx', 'connect_down').draw({
          ...(bounds_pre_tween || bounds),
          w: 10,
        });
      }
      let dist = v2dist([x + ORB_DIM/2, y + ORB_DIM/2], mouse_pos);
      if (dist < closest_dist) {
        closest_idx = [ii, jj];
        closest_dist = dist;
      }
      y += YADV;
    }
  }
  assert(closest_idx);
  const ANYWHERE = { x: -Infinity, y: -Infinity, w: Infinity, h: Infinity };
  let is_mouse_down = mouseDownAnywhere();
  if (!is_mouse_down) {
    game_state.did_save_state = false;
  }
  if (closest_dist < 6) {

    if (mouseDownEdge(ANYWHERE)) {
      game_state.held = closest_idx;
    }
    if (game_state.held && is_mouse_down && game_state.canSwap(closest_idx)) {
      // calc tweening
      let is_from_short = columns[game_state.held[0]].length === ROWS_SHORT;
      let dx = closest_idx[0] - game_state.held[0];
      let dy = (closest_idx[1] - game_state.held[1]) || (is_from_short ? -1 : 1);
      let src_key = game_state.held.join(',');
      let dst_key = closest_idx.join(',');
      let t = tweens[src_key] || [];
      tweens[src_key] = tweens[dst_key] || [];
      tweens[src_key].push({
        t: 0,
        dx,
        dy,
      });
      tweens[dst_key] = t;
      t.push({
        t: 0,
        dx: -dx,
        dy: -dy,
      });

      if (!game_state.did_save_state) {
        game_state.saveState();
      }
      game_state.swap(closest_idx);
    }

    let to_draw: JSVec2 | undefined;
    if (game_state.held) {
      to_draw = game_state.held;
    } else if (!is_mouse_down) {
      to_draw = closest_idx;
    }

    if (to_draw) {
      let { x, y } = idx_to_pos[to_draw[0]][to_draw[1]];
      autoAtlas('gfx', 'select').draw({
        x: x - 1,
        y: y - 1,
        w: ORB_DIM + 2,
        h: ORB_DIM + 2,
        z: Z.UI - 0.5,
      });
    }
  }
  if (!is_mouse_down) {
    game_state.held = null;
  }

  let is_first_short = columns[0].length === ROWS_SHORT;
  autoAtlas('gfx', 'bottom_guard').draw({
    x: board_x - 12 + (is_first_short ? -XADV : 0),
    y: BOARD_Y1 - 4,
    w: 86,
    h: 6,
    z: Z.UI + 10,
  });

  spriteClipPop();

  const GRIND_RATE = 0.01;
  {
    let grind_anim_down = board_anim && board_anim.style === 'both';
    let grinder_x_base = frame_x + 6;
    if (grind_anim_down) {
      grinder_anim_h += dt * GRIND_RATE;
      grinder_anim_h %= PI * 2;
    } else {
      if (grinder_anim_h > 0) {
        grinder_anim_h = min(grinder_anim_h + dt * GRIND_RATE, PI);
      }
    }
    let grinder_x = grinder_x_base + sin(grinder_anim_h) * 4;
    autoAtlas('gfx', 'grinder_h1').draw({
      x: grinder_x,
      y: BOARD_Y1 + 2,
      w: 69,
      h: 5,
      z: 110,
    });
    grinder_x = grinder_x_base + sin(grinder_anim_h - PI*0.65) * 4;
    autoAtlas('gfx', 'grinder_h2').draw({
      x: grinder_x,
      y: BOARD_Y1 + 2,
      w: 69,
      h: 5,
      z: 110 - 0.1,
    });
  }
  {
    let grind_anim_side = board_anim;
    let grinder_y_base = frame_y + 6;
    if (grind_anim_side) {
      grinder_anim_v += dt * GRIND_RATE;
      grinder_anim_v %= PI * 2;
    } else {
      if (grinder_anim_v > 0) {
        grinder_anim_v = min(grinder_anim_v + dt * GRIND_RATE, PI);
      }
    }
    let grinder_y = grinder_y_base + sin(grinder_anim_v) * 4;
    autoAtlas('gfx', 'grinder_v1').draw({
      x: BOARD_X1 + 2,
      y: grinder_y,
      w: 5,
      h: 69,
      z: 110,
    });
    grinder_y = grinder_y_base + sin(grinder_anim_v - PI*0.65) * 4;
    autoAtlas('gfx', 'grinder_v2').draw({
      x: BOARD_X1 + 2,
      y: grinder_y,
      w: 5,
      h: 69,
      z: 110 - 0.1,
    });
  }

  if (buttonImage({
    img: autoAtlas('gfx', 'undo'),
    x: 1,
    y: game_height - uiButtonHeight() - 1,
    shrink: 1,
    hotkey: KEYS.Z,
  })) {
    game_state.undo();
  }

  let power_pos = {
    x: frame_x + 10,
    y: frame_y - 1,
    w: 16,
    h: 16,
    z: Z.UI + 11,
  };
  autoAtlas('gfx', 'power_empty').draw(power_pos);
  // autoAtlas('gfx', 'power_full').draw({
  //   ...power_pos,
  //   z: Z.UI + 1
  // });
  let spot_ret = spot({
    key: 'power',
    def: SPOT_DEFAULT_BUTTON,
    ...power_pos,
    hotkey: KEYS.SPACE,
    disabled: Boolean(board_anim),
  });
  let do_blink = false;
  if (game_state.shouldConsume()) {
    blink += dt * 0.003;
    blink %= 1;
    do_blink = blink < 0.3;
  } else {
    blink = 0;
  }
  if (spot_ret.focused || do_blink) {
    autoAtlas('gfx', 'power_full').draw({
      ...power_pos,
      z: Z.UI + 12,
      // color: palette[2],
    });
  }
  let do_consume: 'auto' | 'down' | null = spot_ret.ret ? 'auto' : null;
  if (engine.DEBUG && keyDownEdge(KEYS.J)) {
    do_consume = 'down';
  }
  if (do_consume) {
    tweens = {};
    board_anim = {
      t: 0,
      column: game_state.columns[0],
      style: null!,
      row: null!,
    };
    let [style, msg, row] = game_state.consume(do_consume);
    messages.push({
      msg,
      t: 0,
    });
    board_anim!.style = style;
    board_anim!.row = row;
  }
}

export function main(): void {
  if (platformParameterGet('reload_updates')) {
    // Enable auto-reload, etc
    netInit({ engine });
  }

  const font_info_04b03x2 = require('./img/font/04b03_8x2.json');
  const font_info_04b03x1 = require('./img/font/04b03_8x1.json');
  const font_info_palanquin32 = require('./img/font/palanquin32.json');
  let pixely = 'strict';
  let font_def;
  let ui_sprites;
  let pixel_perfect = 0;
  if (pixely === 'strict') {
    font_def = { info: font_info_04b03x1, texture: 'font/04b03_8x1' };
    ui_sprites = spriteSetGet('pixely');
    pixel_perfect = 1;
  } else if (pixely && pixely !== 'off') {
    font_def = { info: font_info_04b03x2, texture: 'font/04b03_8x2' };
    ui_sprites = spriteSetGet('pixely');
  } else {
    font_def = { info: font_info_palanquin32, texture: 'font/palanquin32' };
  }

  if (!engine.startup({
    game_width,
    game_height,
    pixely,
    font: font_def,
    viewport_postprocess: false,
    antialias: false,
    ui_sprites,
    pixel_perfect,
    border_color: palette[0],
    border_clear_color: palette[0],
    do_borders: false,
  })) {
    return;
  }
  // let font = engine.font;

  gl.clearColor(palette[0][0], palette[0][1], palette[0][2], 1);

  // Perfect sizes for pixely modes
  scaleSizes(13 / 32);
  setFontHeight(8);
  setButtonHeight(9);

  init();

  engine.setState(statePlay);
}
