// Renders src/storyboard.json (the shot-by-shot board) as STORYBOARD.md.
//   node scripts/storyboard-md.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const b = JSON.parse(fs.readFileSync(path.join(root, 'src', 'storyboard.json'), 'utf8'));
const t = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const out = [];
out.push(`# ${b.title}`, '', `> ${b.logline}`, '', `**Runtime** ${b.runtimeSeconds}s · **Format** 1080×1920, 30 fps · **Score** ${b.bpm} BPM`, '');
out.push('## Cast (Kokoro-82M voices)', '', '| Role | Voice | Speed | Treatment |', '| --- | --- | --- | --- |');
for (const v of b.voices) out.push(`| ${v.role} | \`${v.kokoroVoice}\` | ${v.speed} | ${v.treatment.replace(/\n/g, ' ')} |`);
out.push('', '## Story at a glance', '', '| Shot | Time | Scene | Line |', '| --- | --- | --- | --- |');
for (const s of b.shots) out.push(`| ${s.id} | ${t(s.start)}–${t(s.end)} | ${s.scene} | ${s.dialogue.map((d) => `**${d.role.split(' (')[0]}:** ${d.line}`).join('<br>') || '—'} |`);
out.push('', '## Shot by shot', '');
for (const s of b.shots) {
  out.push(`### ${s.id} · ${s.scene} · ${t(s.start)}–${t(s.end)} (${(s.end - s.start).toFixed(1)}s)`, '');
  out.push(`**Visual.** ${s.visual}`, '', `**Motion.** ${s.motion}`, '');
  if (s.onScreenText) out.push(`**On-screen text.** ${s.onScreenText}`, '');
  for (const d of s.dialogue) out.push(`> **${d.role}:** ${d.line}`);
  if (s.dialogue.length) out.push('');
  out.push(`**Sound.** ${s.sfx}`, '', `**Music.** ${s.music}`, '');
  if (s.claimRefs.length) out.push(`**Claims.** ${s.claimRefs.join(', ')}`, '');
}
out.push('## Music', '', b.musicDirection, '', '## Captions', '', b.captionsStyle, '', '## Cover frame', '', b.coverFrame, '');
out.push('## Instagram post', '', b.instagramCaption, '', b.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' '), '');
out.push('## Claims and evidence', '', '| Claim | Said in the ad | Evidence (on the latest app branch) |', '| --- | --- | --- |');
for (const c of b.claims) out.push(`| ${c.id} | ${c.said.replace(/\|/g, '\\|')} | ${c.evidence.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
out.push('', '## Production notes', '', b.productionNotes, '');
fs.writeFileSync(path.join(root, 'STORYBOARD.md'), out.join('\n'));
console.log(`STORYBOARD.md: ${b.shots.length} shots, ${b.runtimeSeconds}s`);
