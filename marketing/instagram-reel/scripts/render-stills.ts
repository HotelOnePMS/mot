// Renders review stills and contact sheets.
//   node scripts/render-stills.ts                 every shot at 45% and at its last frame -3 -> out/stills, out/storyboard-{1,2}.jpg
//   node scripts/render-stills.ts --scene Morning one scene's shots (same two frames each) -> out/stills/<scene>/
//   node scripts/render-stills.ts --frames 0,1155 exact frames -> out/stills/frames/
//   add --safe to draw the Instagram UI zones (top 270, bottom 380, right 140) on each still
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {browserExecutable} from './browser.ts';
import board from '../src/storyboard.json' with {type: 'json'};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const safe = args.includes('--safe');
const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);

type Job = {frame: number; name: string; label: string};
const shotJobs = (shots: typeof board.shots): Job[] =>
  shots.flatMap((s) => {
    const from = f(s.start);
    const to = f(s.end);
    const mid = from + Math.floor((to - from) * 0.45);
    const late = Math.max(from, to - 3);
    return [
      {frame: mid, name: `${s.id}-a`, label: `${s.id} ${s.scene} f${mid}`},
      {frame: late, name: `${s.id}-b`, label: `${s.id} ${s.scene} f${late}`},
    ];
  });

let jobs: Job[];
let outDir: string;
const scene = opt('scene');
const frames = opt('frames');
if (frames) {
  jobs = frames.split(',').map((x) => Number(x.trim())).map((frame) => ({frame, name: `f${String(frame).padStart(4, '0')}`, label: `f${frame}`}));
  outDir = path.join(root, 'out', 'stills', 'frames');
} else if (scene) {
  const shots = board.shots.filter((s) => s.scene === scene);
  if (!shots.length) throw new Error(`No scene ${scene}`);
  jobs = shotJobs(shots);
  outDir = path.join(root, 'out', 'stills', scene);
} else {
  jobs = shotJobs(board.shots);
  outDir = path.join(root, 'out', 'stills');
}
fs.mkdirSync(outDir, {recursive: true});

const serveUrl = await bundle({entryPoint: path.join(root, 'src', 'index.ts')});
const composition = await selectComposition({serveUrl, id: 'ReelSilent', inputProps: {placement: 'organic', withAudio: false}, browserExecutable});

for (const job of jobs) {
  const output = path.join(outDir, `${job.name}.jpg`);
  await renderStill({composition, serveUrl, output, frame: job.frame, imageFormat: 'jpeg', jpegQuality: 90, browserExecutable, inputProps: {placement: 'organic', withAudio: false}});
  if (safe) {
    const boxes = ['drawbox=x=0:y=0:w=iw:h=270:color=magenta@0.25:t=fill', 'drawbox=x=0:y=ih-380:w=iw:h=380:color=magenta@0.25:t=fill', 'drawbox=x=iw-140:y=0:w=140:h=ih:color=magenta@0.25:t=fill'];
    const tmp = output.replace(/\.jpg$/, '.tmp.jpg');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', output, '-vf', boxes.join(','), '-q:v', '3', tmp]);
    fs.renameSync(tmp, output);
  }
  console.log(`${job.label} -> ${path.relative(root, output)}`);
}

// Contact sheets for the full pass: one cell per still, labelled, 7 across.
if (!frames && !scene) {
  for (const [suffix, sheet] of [['a', 1], ['b', 2]] as const) {
    const cells = jobs.filter((j) => j.name.endsWith(`-${suffix}`));
    const inputs = cells.flatMap((j) => ['-i', path.join(outDir, `${j.name}.jpg`)]);
    const scaled = cells.map((j, i) => `[${i}:v]scale=360:640,drawtext=text='${j.label}':x=10:y=10:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6[c${i}]`).join(';');
    const cols = 7;
    const rows = Math.ceil(cells.length / cols);
    const layout = cells.map((_, i) => `${(i % cols) * 360}_${Math.floor(i / cols) * 640}`).join('|');
    const filter = `${scaled};${cells.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${cells.length}:layout=${layout}:fill=black[out]`;
    const output = path.join(root, 'out', `storyboard-${sheet}.jpg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', '-q:v', '3', output]);
    console.log(`contact sheet (${cols}x${rows}) -> ${path.relative(root, output)}`);
  }
}
