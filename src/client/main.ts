/* eslint n/global-require:off */
// eslint-disable-next-line import/order
const local_storage = require('glov/client/local_storage');
local_storage.setStoragePrefix('ld57'); // Before requiring anything else that might load from this

const GAME_OVER = 25;
const VICTORY = 12;
const DOWN_SCALE = 5;

import assert from 'assert';
import { autoAtlas } from 'glov/client/autoatlas';
import * as camera2d from 'glov/client/camera2d';
import { platformParameterGet } from 'glov/client/client_config';
import { applyCopy, effectsQueue, registerShader } from 'glov/client/effects';
import * as engine from 'glov/client/engine';
import { getFrameDt, getFrameTimestamp } from 'glov/client/engine';
import { ALIGN, fontStyle, fontStyleColored, vec4ColorFromIntColor } from 'glov/client/font';
import { Box } from 'glov/client/geom_types';
import {
  eatAllInput,
  keyDownEdge,
  KEYS,
  mouseDownAnywhere,
  mouseDownEdge,
  mousePos,
} from 'glov/client/input';
import { markdownAuto } from 'glov/client/markdown';
import { markdownImageRegisterAutoAtlas, markdownSetColorStyles } from 'glov/client/markdown_renderables';
import { netInit } from 'glov/client/net';
import {
  scoreAlloc,
  ScoreSystem,
} from 'glov/client/score';
import * as settings from 'glov/client/settings';
import { shaderCreate } from 'glov/client/shaders';
import { soundPlayMusic } from 'glov/client/sound';
import { spot, SPOT_DEFAULT_BUTTON } from 'glov/client/spot';
import { spriteSetGet } from 'glov/client/sprite_sets';
import { Shader, Sprite, spriteClipPop, spriteClipPush, spriteCreate } from 'glov/client/sprites';
import { textureLoad } from 'glov/client/textures';
import {
  buttonImage,
  buttonText,
  drawHBox,
  drawRect,
  panel,
  playUISound,
  scaleSizes,
  setButtonHeight,
  setFontHeight,
  setFontStyles,
  uiButtonHeight,
  uiButtonWidth,
  uiGetFont,
  uiSetPanelColor,
  uiTextHeight,
} from 'glov/client/ui';
import { randCreate, shuffleArray } from 'glov/common/rand_alea';
import { TSMap } from 'glov/common/types';
import { clone, easeIn, easeInOut, easeOut, lerp, ridx, tweenBounceOut } from 'glov/common/util';
import {
  JSVec2,
  unit_vec,
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

const { abs, max, min, floor, round, sin, PI } = Math;

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.SPRITES = 10;
Z.HELP = 300;

// Virtual viewport for our game logic
const game_width = 100;
const game_height = 100;

const COLUMNS = 7;
const ROWS_TALL = 6;
const ROWS_SHORT = ROWS_TALL - 1;

type Score = {
  good: number;
  bad: number;
};
let score_system: ScoreSystem<Score>;

let rand = randCreate(Date.now());

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
  columns!: number[][];
  held: JSVec2 | null = null;
  first_column_is_high = true;
  count_bad = 0;
  count_good = 0;
  good_since_clear = 0;

  queue: number[] = [];
  refillOrbs(): void {
    let new_orbs = [];
    for (let ii = 1; ii <= 3; ++ii) {
      for (let jj = 0; jj < 22; ++jj) {
        new_orbs.push(ii);
      }
    }
    shuffleArray(rand, new_orbs);
    this.queue = this.queue.concat(new_orbs);
  }
  orb(): number {
    if (!this.queue.length) {
      this.refillOrbs();
    }
    return this.queue.shift()!;
  }

  redraw(): void {
    this.held = null;
    this.good_since_clear = 0;
    this.columns = [];
    for (let ii = 0; ii < COLUMNS; ++ii) {
      let row = [];
      for (let jj = 0; jj < (ii % 2 ? ROWS_SHORT : ROWS_TALL); ++jj) {
        row.push(this.orb());
      }
      this.columns.push(row);
    }
  }

  constructor() {
    this.redraw();
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
    let is_tall = column.length === ROWS_TALL;
    for (let ii = 0; ii < column.length; ++ii) {
      counts[column[ii]]++;
    }
    let count_white = counts[1];

    let result: 'both' | 'right' = 'right';
    let msg;
    if (count_white === column.length || move === 'down') {
      playUISound('consume_good');
      msg = 'Perfect!';
      result = 'both';
      this.count_good++;
      this.good_since_clear++;
    } else {
      let deduct_points = this.count_good;
      if (deduct_points) {
        this.count_bad++;
      }
      if (count_white) {
        if (deduct_points) {
          this.count_bad++;
        }
        msg = `${deduct_points ? '-2 ' : ''}Wasteful!`;
        playUISound('consume_bad');
      } else {
        msg = `${deduct_points ? '-1 ' : ''}Just rocks`;
        playUISound('consume_okay');
      }
    }
    this.columns.splice(0, 1);

    score_system.setScore(0, {
      good: this.count_good,
      bad: this.count_bad,
    });


    let row = [];
    if (result === 'both') {
      for (let ii = 0; ii < this.columns.length; ++ii) {
        let col = this.columns[ii];
        row.push(col.shift()!);
      }
    }


    let need_new = is_tall ? ROWS_SHORT : ROWS_TALL;

    if (result === 'both') {
      need_new += COLUMNS - 1;
    }

    let remaining_white = 0;
    for (let ii = 0; ii < this.columns.length; ++ii) {
      let col = this.columns[ii];
      for (let jj = 0; jj < col.length; ++jj) {
        if (col[jj] === 1) {
          remaining_white++;
        }
      }
    }

    let need_new_white = min(need_new, max(0, 8 - remaining_white));
    if (need_new_white) {
      if (this.queue.length < need_new) {
        this.refillOrbs();
      }
      let getting_white = 0;
      let non_white_idxs = [];
      for (let ii = 0; ii < need_new; ++ii) {
        if (this.queue[ii] === 1) {
          ++getting_white;
        } else {
          non_white_idxs.push(ii);
        }
      }
      for (let ii = getting_white; ii < need_new_white; ++ii) {
        assert(non_white_idxs.length);
        let idx_idx = rand.range(non_white_idxs.length);
        let idx = non_white_idxs[idx_idx];
        ridx(non_white_idxs, idx_idx);
        this.queue[idx] = 1;
      }
    }

    if (result === 'both') {
      for (let ii = 0; ii < this.columns.length; ++ii) {
        let col = this.columns[ii];
        col.push(this.orb());
      }
    }

    let new_column = [];
    for (let ii = 0; ii < (is_tall ? ROWS_SHORT : ROWS_TALL); ++ii) {
      new_column.push(this.orb());
    }
    this.columns.push(new_column);


    return [result, msg, row];
  }

  shouldConsume(): boolean {
    let c0 = this.columns[0];
    let all_white = true;
    // let all_other = true;
    for (let ii = 0; ii < c0.length; ++ii) {
      if (c0[ii] === 1) {
        // all_other = false;
      } else {
        all_white = false;
      }
    }
    return all_white; // || all_other;
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

let last_swap_time = 0;
let last_swap_up = false;
let last_swap_idx = 0;
function playSwap(up: boolean): void {
  let now = getFrameTimestamp();
  if (now - last_swap_time < 1000 && last_swap_up === up) {
    ++last_swap_idx;
  } else {
    last_swap_idx = 1;
  }
  last_swap_idx = min(last_swap_idx, 8);
  last_swap_up = up;
  last_swap_time = now;
  playUISound(`${up ? 'up' : 'down'}${last_swap_idx}`);
}

let bg: Sprite;
let mask: Sprite;
let effect: Sprite;
let game_state: GameState;
let part_sprites: Sprite[] = [];
let origin_center = vec2(0.5, 0.5);
let shader_bgmask: Shader;
function init(): void {
  bg = spriteCreate({
    name: 'bg',
  });
  registerShader('repalette', {
    fp: 'shaders/repalette.fp',
  });
  shader_bgmask = shaderCreate('shaders/bgmask.fp');
  let tex_bgdither = textureLoad({
    url: 'img/bgdither.png',
  });
  let tex_mask = textureLoad({
    url: 'img/mask.png',
    wrap_s: gl.CLAMP_TO_EDGE,
    wrap_t: gl.CLAMP_TO_EDGE,
    filter_mag: gl.NEAREST,
    filter_min: gl.NEAREST,
  });
  mask = spriteCreate({
    texs: [tex_bgdither, tex_mask],
  });
  effect = spriteCreate({
    name: 'effect',
    filter_mag: gl.LINEAR,
    filter_min: gl.LINEAR_MIPMAP_LINEAR,
  });
  for (let ii = 1; ii <= 4; ++ii) {
    part_sprites.push(autoAtlas('gfx', `part${ii}`).withOrigin(origin_center));
  }

  const ENCODE_BAD = 1000;
  score_system = scoreAlloc({
    score_to_value: (score: Score): number => {
      return ENCODE_BAD - 1 - score.bad +
        score.good * ENCODE_BAD;
    },
    value_to_score: (value: number): Score => {
      let p = value % ENCODE_BAD;
      value -= p;
      return {
        bad: ENCODE_BAD - 1 - p,
        good: floor(value / ENCODE_BAD),
      };
    },
    level_defs: 1,
    score_key: 'LD57',
    ls_key: 'ld57',
    asc: false,
    rel: 1,
    num_names: 1,
    histogram: false,
  });
  soundPlayMusic('bgm');
}

const ORB_DIM = 8;
const ORB_XPAD = 1;
const ORB_YPAD = 2;
const XADV = ORB_DIM + ORB_XPAD;
const YADV = ORB_DIM + ORB_YPAD;
const BOARD_X = floor((game_width - (ORB_DIM * COLUMNS + ORB_XPAD * (COLUMNS - 1))) / 2) + 2;
const BOARD_Y = floor((game_height - (ORB_DIM * ROWS_TALL + ORB_YPAD * (ROWS_TALL - 1))) / 2) + 4;
const BOARD_Y1 = BOARD_Y + YADV * 6 - ORB_YPAD;
const BOARD_X1 = BOARD_X + XADV * 7 - ORB_XPAD;

let bg_offs = [0, 0];
function drawBG(dx: number, dy: number): void {
  let x = floor(camera2d.x0Real());
  let y = floor(camera2d.y0Real());
  let h = floor(camera2d.hReal()) + 2;
  let w = floor(camera2d.wReal()) + 2;
  let uoffs1 = (bg_offs[0] - dx + x) / 128;
  let voffs1 = (bg_offs[1] - dy + y) / 128;
  bg.draw({
    x, y, w, h,
    uvs: [
      uoffs1, voffs1,
      w/128 + uoffs1, h/128 + voffs1,
    ],
    z: 1,
  });
  if (1) {
    mask.draw({
      x, y, w, h,
      // uvs: [0, 0, 1, 1],
      shader: shader_bgmask,
      shader_params: {
        uv1: [w/128, h/128, uoffs1, voffs1],
        uv2: [w/256, h/256, (256 - (BOARD_X1 + 7 - x))/256, (256 - (BOARD_Y1 + 8 - y))/256],
      },
      z: 2,
    });
  }
  if (1) {
    let du = 15/32;
    effect.draw({
      x, y, w, h,
      z: 900,
      uvs: [0+du, 0+du, w+du, h+du],
      color: [1,1,1,0.25],
      nozoom: true,
    });
  }
  drawRect(BOARD_X - 2, BOARD_Y - 2, BOARD_X1 + 1, BOARD_Y1 + 1, 3, palette[0]);
}
type Tween = {
  dx: number;
  dy: number;
  t: number;
};
let tweens: TSMap<Tween[]> = {};

function drawOrb(
  tween_key: string, x: number, y: number, z: number,
  moves_up: boolean, moves_down: boolean, cell: number
): Box {
  let bounds = {
    x, y, z,
    w: ORB_DIM,
    h: ORB_DIM,
  };
  let bounds_pre_tween: Box | null = null;
  let tween = tweens[tween_key];
  if (tween) {
    for (let kk = tween.length - 1; kk >= 0; --kk) {
      let elem = tween[kk];
      elem.t += getFrameDt() * 0.01;
      if (elem.t >= 1) {
        ridx(tween, kk);
        continue;
      }
      if (!bounds_pre_tween) {
        bounds_pre_tween = {
          ...bounds,
        };
      }
      bounds.x += floor((1 - elem.t) * elem.dx * (XADV + 1));
      bounds.y += floor((1 - elem.t) * elem.dy * (YADV / 2 - 1));
    }
  }
  autoAtlas('gfx', `orb${cell}`).draw(bounds);
  if (moves_up) {
    autoAtlas('gfx', 'connect_up').draw({
      ...(bounds_pre_tween || bounds),
      w: 10,
    });
  }
  if (moves_down) {
    autoAtlas('gfx', 'connect_down').draw({
      ...(bounds_pre_tween || bounds),
      w: 10,
    });
  }
  return bounds;
}

let help_timer = 0;
let help_swapped = false;
function showHelp(): void {
  help_timer += getFrameDt();
  if (help_timer > 1000) {
    help_timer = 0;
    if (help_swapped) {
      tweens = {};
      help_swapped = false;
    } else {
      help_swapped = true;
      tweens.help11 = [{
        dx: -1,
        dy: 1,
        t: 0,
      }];
      tweens.help12 = [{
        dx: 1,
        dy: -1,
        t: 0,
      }];
      tweens.help21 = [{
        dx: -1,
        dy: 1,
        t: 0,
      }];
      tweens.help22 = [{
        dx: 1,
        dy: -1,
        t: 0,
      }];
      tweens.help31 = [{
        dx: -1,
        dy: 1,
        t: 0,
      }];
      tweens.help32 = [{
        dx: 1,
        dy: -1,
        t: 0,
      }];
    }
  }
  let z = Z.HELP;
  let font = uiGetFont();
  let x = 4;
  let w = game_width - x * 2;
  let y = 4;
  const PAD = 4;
  const ORBYD = PAD + 8;
  y += markdownAuto({
    x, y, w, z,
    align: ALIGN.HLEFT|ALIGN.HWRAP,
    text: '[img=orb3] [c=1]COAL[/c] swaps up through [img=orb2] [c=2]STONE[/c]',
  }).h + PAD;
  let orb_x = 79;
  drawOrb(help_swapped ? 'help12' : 'help11', orb_x, y - ORBYD, z, !help_swapped, false, help_swapped ? 2 : 3);
  drawOrb(help_swapped ? 'help11' : 'help12', orb_x + XADV, y - ORBYD - 4, z, false, false, help_swapped ? 3 : 2);
  y += markdownAuto({
    x, y, w, z,
    align: ALIGN.HLEFT|ALIGN.HWRAP,
    text: '[img=orb2] [c=2]STONE[/c] swaps up through [img=orb1] [c=3]GOLD[/c]',
  }).h + PAD;
  drawOrb(help_swapped ? 'help32' : 'help31', orb_x, y - ORBYD, z, !help_swapped, false, help_swapped ? 1 : 2);
  drawOrb(help_swapped ? 'help31' : 'help32', orb_x + XADV, y - ORBYD - 4, z, false, false, help_swapped ? 2 : 1);
  y += markdownAuto({
    x, y, w, z,
    align: ALIGN.HLEFT|ALIGN.HWRAP,
    text: '[img=orb1] [c=3]GOLD[/c] swaps up through [img=orb3] [c=1]COAL[/c]',
  }).h + PAD;
  drawOrb(help_swapped ? 'help22' : 'help21', orb_x, y - ORBYD, z, !help_swapped, false, help_swapped ? 3 : 1);
  drawOrb(help_swapped ? 'help21' : 'help22', orb_x + XADV, y - ORBYD - 4, z, false, false, help_swapped ? 1 : 3);

  y += font.draw({
    color: palette_font[2],
    x, y, w, z,
    align: ALIGN.HCENTER|ALIGN.HWRAP,
    text: '(or the opposite swaps down)',
  });

  y = game_height - 12;

  font.draw({
    color: palette_font[3],
    x: x - 2, y, w: w + 4, z,
    align: ALIGN.HCENTER|ALIGN.HWRAP,
    text: 'Goal: Pure gold in left',
  });

  panel({
    x: 1, y: 1,
    z: z - 1,
    w: game_width-2,
    h: game_height-2,
  });
}

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
let help_visible = false;

function newGame(): void {
  game_state = new GameState();
}

type Particle = {
  x: number;
  y: number;
  r: number;
  img: number;
  toffs: number;
  t: number;
  vx: number;
  vy: number;
};
let particles: Particle[] = [];
function addParticles(style: 'both' | 'right'): void {
  function addPart(x: number, y: number): void {
    particles.push({
      x, y,

      r: rand.range(4) * PI/2,
      img: rand.range(4),
      t: 0,
      toffs: rand.random(),
      vx: -4 + rand.range(9),
      vy: -4 + rand.range(9),
    });
  }
  if (style === 'both') {
    for (let ii = 0; ii < 40; ++ii) {
      addPart(
        BOARD_X - 8 + rand.range(BOARD_X1 - BOARD_X + 12),
        BOARD_Y1 + 6 + floor(rand.random() * rand.random() * 6),
      );
    }
  }
  for (let ii = 0; ii < 40; ++ii) {
    addPart(
      BOARD_X1 + 7 + floor(rand.random() * rand.random() * 6),
      BOARD_Y - 8 + rand.range(BOARD_Y1 - BOARD_Y + 8),
    );
  }
}

function statePlay(dt: number): void {
  camera2d.setAspectFixedRespectPixelPerfect(game_width, game_height);
  gl.clearColor(palette[0][0], palette[0][1], palette[0][2], 1);
  let font = uiGetFont();

  effectsQueue(899, function () {
    applyCopy({
      shader: 'repalette',
      params: {
        param: [game_state.count_good / VICTORY, 1],
      },
    });
  });

  if (help_visible) {
    showHelp();
  }

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
      style: fontStyle(null, {
        color: palette_font[3],
        outline_color: palette_font[0],
        outline_width: 5,
      }),
      x: frame_x,
      y: frame_y - 8 - floor(easeIn(m.t, 2) * 64),
      text: m.msg,
      z: Z.UI + 30,
    });
  }

  for (let ii = particles.length - 1; ii >= 0; --ii) {
    let part = particles[ii];
    part.t += dt/2000;
    if (part.t + part.toffs >= 1) {
      ridx(particles, ii);
      continue;
    }
    part_sprites[(part.img + floor((part.t + part.toffs) * 8)) % 4].draw({
      x: part.x + floor(easeIn(part.t, 2) * part.vx),
      y: part.y + floor(easeIn(part.t, 2) * part.vy),
      w: 8, h: 8,
      rot: part.r,
      z: 200,
    });
  }

  let board_xoffs = 0;
  let board_yoffs = 0;
  if (board_anim) {
    board_anim.t += dt/1000;
    if (board_anim.t >= 1) {
      board_anim = null;
    } else {
      board_xoffs = XADV - floor(XADV * easeIn(board_anim.t, 2));
      board_x += board_xoffs;
      if (board_anim.style === 'both') {
        board_yoffs = YADV - floor(YADV * board_anim.t);
        board_y += board_yoffs;
      }
    }
  }

  drawBG(board_xoffs, board_anim?.style === 'both' ? floor((YADV - YADV * board_anim.t) * DOWN_SCALE) : 0);

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
  } else {
    font.draw({
      size: uiTextHeight() * 2,
      style: fontStyle(null, {
        color: palette_font[3],
        outline_color: palette_font[1],
        outline_width: 5,
      }),
      x: 0, y: -4,
      w: game_width, h: game_height,
      z: 500,
      align: ALIGN.HVCENTER | ALIGN.HWRAP,
      text: 'GAME\nOVER',
    });
    font.draw({
      style: fontStyle(null, {
        color: palette_font[3],
        outline_color: palette_font[1],
        outline_width: 5,
      }),
      x: 0, y: 17,
      w: game_width, h: game_height,
      z: 500,
      align: ALIGN.HVCENTER,
      text: `${count_good} / ${VICTORY} refined`,
    });
    let y0 = (game_height - 46)/2;
    let y1 = (game_height + 46)/2 + 13;
    let button_w = uiButtonWidth();
    if (buttonText({
      x: floor((game_width - button_w)/2),
      y: y1 - uiButtonHeight() - 3,
      z: 500,
      text: 'PLAY AGAIN',
    })) {
      newGame();
    }

    panel({
      x: 2,
      y: y0,
      w: game_width - 4,
      h: y1 - y0,
      z: 500,
    });

    eatAllInput();
  }
  if (count_good === VICTORY) {
    font.draw({
      size: uiTextHeight() * 2,
      style: fontStyle(null, {
        color: palette_font[3],
        outline_color: palette_font[1],
        outline_width: 5,
      }),
      x: 1, y: 1,
      w: game_width, h: game_height,
      z: 500,
      align: ALIGN.HVCENTER,
      text: 'YOU WIN',
    });
    font.draw({
      style: fontStyle(null, {
        color: palette_font[3],
        outline_color: palette_font[1],
        outline_width: 5,
      }),
      x: 0, y: 13,
      w: game_width, h: game_height,
      z: 500,
      align: ALIGN.HVCENTER,
      text: count_bad ? `Penalty: ${count_bad}` : `PERFECT! (${GAME_OVER})`,
    });
    let y0 = (game_height - 20)/2 - 2;
    let y1 = (game_height + 20) / 2 + 10 + 13;
    let button_w = uiButtonWidth();
    if (buttonText({
      x: floor((game_width - button_w)/2),
      y: y1 - uiButtonHeight() - 3,
      z: 500,
      text: 'PLAY AGAIN',
    })) {
      newGame();
    }

    panel({
      x: 2,
      y: y0,
      w: game_width - 4,
      h: y1 - y0,
      z: 500,
    });

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
      let up_idx = is_short ? jj : jj - 1;
      let up = right?.[up_idx];
      let down = right?.[up_idx+1];
      let moves_up = moves(cell, up, true);
      let moves_down = moves(cell, down, false);
      let bounds = drawOrb(`${ii},${jj}`, x, y, Z.UI, moves_up, moves_down, cell);

      pos_column[jj] = bounds;
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
      playSwap(dy < 0);
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
    let grinder_x_base = frame_x + 4;
    grinder_anim_h += dt * GRIND_RATE * (grind_anim_down ? 1 : 0.06);
    grinder_anim_h %= PI * 2;
    let grinder_x = floor(grinder_x_base + sin(grinder_anim_h) * 4);
    autoAtlas('gfx', 'grinder_h1').draw({
      x: grinder_x,
      y: BOARD_Y1 + 2,
      w: 71,
      h: 6,
      z: 110,
    });
    autoAtlas('gfx', 'grinder_hshadow').draw({
      x: grinder_x,
      y: BOARD_Y1 + 2,
      w: 71,
      h: 6,
      z: 110 - 0.2,
    });
    grinder_x = floor(grinder_x_base + sin(grinder_anim_h - PI*0.65) * 4);
    autoAtlas('gfx', 'grinder_h2').draw({
      x: grinder_x,
      y: BOARD_Y1 + 2,
      w: 71,
      h: 6,
      z: 110 - 0.1,
    });
    autoAtlas('gfx', 'grinder_hshadow').draw({
      x: grinder_x,
      y: BOARD_Y1 + 2,
      w: 71,
      h: 6,
      z: 110 - 0.2,
    });
  }
  {
    let grind_anim_side = board_anim;
    let grinder_y_base = frame_y + 2;
    grinder_anim_v += dt * GRIND_RATE * (grind_anim_side ? 1 : 0.06);
    grinder_anim_v %= PI * 2;
    let grinder_y = floor(grinder_y_base + sin(grinder_anim_v) * 4);
    autoAtlas('gfx', 'grinder_v1').draw({
      x: BOARD_X1 + 2,
      y: grinder_y,
      w: 6,
      h: 71,
      z: 110,
    });
    autoAtlas('gfx', 'grinder_vshadow').draw({
      x: BOARD_X1 + 2,
      y: grinder_y,
      w: 6,
      h: 71,
      z: 110 - 0.2,
    });
    grinder_y = floor(grinder_y_base + sin(grinder_anim_v - PI*0.65) * 4);
    autoAtlas('gfx', 'grinder_v2').draw({
      x: BOARD_X1 + 2,
      y: grinder_y,
      w: 6,
      h: 71,
      z: 110 - 0.1,
    });
    autoAtlas('gfx', 'grinder_vshadow').draw({
      x: BOARD_X1 + 2,
      y: grinder_y,
      w: 6,
      h: 71,
      z: 110 - 0.2,
    });
  }

  let buttons_y = round(camera2d.y0()) + 1;
  let buttons_x = round(camera2d.x1()) - uiButtonHeight() - 1;
  if (buttonImage({
    img: autoAtlas('gfx', 'help'),
    x: buttons_x,
    y: buttons_y,
    z: Z.HELP + 1,
    shrink: 1,
    hotkeys: [KEYS.F1, KEYS.SLASH, KEYS.H, ...(help_visible ? [KEYS.ESC] : [])],
  })) {
    help_visible = !help_visible;
  }

  if (buttonImage({
    img: autoAtlas('gfx', settings.volume_music ? 'music_on' : 'music_off'),
    x: buttons_x,
    y: round(camera2d.y1()) - uiButtonHeight() - 1,
    z: Z.HELP + 1,
    shrink: 1,
    hotkeys: [KEYS.M],
  })) {
    settings.settingsSet('volume_music', 1 - settings.volume_music);
    if (settings.volume_music) {
      soundPlayMusic('bgm');
    }
  }

  if (game_state.last_columns && buttonImage({
    img: autoAtlas('gfx', 'undo'),
    x: round(camera2d.x0()) + 1,
    y: round(camera2d.y1()) - uiButtonHeight() - 1,
    shrink: 1,
    hotkey: KEYS.Z,
  })) {
    game_state.undo();
  }

  const button_w = 53;
  // eslint-disable-next-line no-constant-binary-expression
  if (false && game_state.good_since_clear >= 3 && buttonText({
    x: round(camera2d.x1()) - button_w - 1,
    y: round(camera2d.y1()) - uiButtonHeight() - 1,
    w: button_w,
    z: 200,
    text: 'New board',
  })) {
    game_state.redraw();
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
    bg_offs[0] += XADV;
    if (style === 'both') {
      bg_offs[1] += YADV*DOWN_SCALE;
    }
    addParticles(style);
  }
}

export function main(): void {
  if (platformParameterGet('reload_updates')) {
    // Enable auto-reload, etc
    netInit({ engine });
  }

  const font_info_04b03x1 = require('./img/font/04b03_8x1.json');
  let pixely = 'on';
  let font_def;
  let ui_sprites;
  let pixel_perfect = 1;
  font_def = { info: font_info_04b03x1, texture: 'font/04b03_8x1' };
  ui_sprites = spriteSetGet('pixely');
  pixel_perfect = 1;

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
    show_fps: false,
    ui_sounds: {
      up1: 'up1',
      up2: 'up2',
      up3: 'up3',
      up4: 'up4',
      up5: 'up5',
      up6: 'up6',
      up7: 'up7',
      up8: 'up8',
      down1: 'down1',
      down2: 'down2',
      down3: 'down3',
      down4: 'down4',
      down5: 'down5',
      down6: 'down6',
      down7: 'down7',
      down8: 'down8',
      rollover: { file: 'rollover', volume: 0.5 },
      consume_okay: 'consume_okay',
      consume_good: 'consume_good',
      consume_bad: 'consume_bad',
    },
  })) {
    return;
  }
  // let font = engine.font;

  gl.clearColor(palette[0][0], palette[0][1], palette[0][2], 1);

  // Perfect sizes for pixely modes
  scaleSizes(13 / 32);
  setFontHeight(8);
  setButtonHeight(9);
  setFontStyles(
    fontStyleColored(null, palette_font[3]),
  );
  uiSetPanelColor(unit_vec);
  markdownImageRegisterAutoAtlas('gfx');
  markdownSetColorStyles([
    fontStyle(null, {
      color: palette_font[0],
    }),
    fontStyle(null, {
      color: palette_font[1],
    }),
    fontStyle(null, {
      color: palette_font[2],
    }),
    fontStyle(null, {
      color: palette_font[3],
    }),
  ]);

  init();
  newGame();

  engine.setState(statePlay);
}
