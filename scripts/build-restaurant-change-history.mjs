import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repository = process.argv[2];
const output = process.argv[3];
if (!repository || !output) {
  throw new Error('사용법: node scripts/build-restaurant-change-history.mjs <product1 저장소> <출력 파일>');
}

const git = (...args) => execFileSync('git', ['-C', repository, ...args], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 256
}).trim();
const readAt = (ref, file) => JSON.parse(git('show', `${ref}:${file}`));
const commits = git('log', '--format=%H', '--', 'data/restaurants/regions.json').split('\n').filter(Boolean);
const existing = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { entries: [] };

if (commits.length < 2) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ updatedAt: null, entries: existing.entries || [] }, null, 2)}\n`);
  console.log('비교 가능한 식당 데이터 갱신 커밋이 아직 2개 미만입니다.');
  process.exit(0);
}

const [currentRef, previousRef] = commits;
if (existing.entries?.some(entry => entry.sourceCommit === currentRef)) {
  console.log('최신 식당 데이터 변경 이력이 이미 기록되어 있습니다.');
  process.exit(0);
}

function snapshot(ref) {
  const manifest = readAt(ref, 'data/restaurants/regions.json');
  const rows = new Map();
  for (const region of manifest.regions || []) {
    for (const file of region.files || [region.file]) {
      for (const restaurant of readAt(ref, `data/restaurants/${file}`)) {
        const id = restaurant.id || `${restaurant.name}|${restaurant.address}`;
        rows.set(id, {
          id,
          name: restaurant.name || '',
          address: restaurant.address || '',
          category: restaurant.category || '',
          permitDate: restaurant.permitDate || ''
        });
      }
    }
  }
  return { manifest, rows };
}

const current = snapshot(currentRef);
const previous = snapshot(previousRef);
const added = [...current.rows].filter(([id]) => !previous.rows.has(id)).map(([, row]) => row);
const removed = [...previous.rows].filter(([id]) => !current.rows.has(id)).map(([, row]) => row);
if (added.length + removed.length > 75000) {
  throw new Error(`안전 중단: 하루 변경 이력이 ${(added.length + removed.length).toLocaleString('ko-KR')}건입니다.`);
}
const byName = (left, right) => left.name.localeCompare(right.name, 'ko') || left.address.localeCompare(right.address, 'ko');
added.sort(byName);
removed.sort(byName);

const entry = {
  date: String(current.manifest.updatedAt || '').slice(0, 10),
  updatedAt: current.manifest.updatedAt || new Date().toISOString(),
  sourceCommit: currentRef,
  previousCommit: previousRef,
  total: current.manifest.total,
  addedCount: added.length,
  removedCount: removed.length,
  added,
  removed
};
const entries = [entry, ...(existing.entries || []).filter(item => item.sourceCommit !== currentRef)]
  .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  .slice(0, 90);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 2)}\n`);
console.log(`${entry.date}: 추가 ${added.length.toLocaleString('ko-KR')}곳 / 제거 ${removed.length.toLocaleString('ko-KR')}곳`);
