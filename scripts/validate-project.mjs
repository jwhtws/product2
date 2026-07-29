import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const roots = ['admin.js', 'functions', 'scripts'];
const javascript = [];

function collect(path) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) collect(join(path, entry));
  } else if (/\.[cm]?js$/.test(path)) {
    javascript.push(path);
  }
}

for (const root of roots) collect(root);
for (const file of javascript) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`${file}\n${result.stderr}`);
    process.exitCode = 1;
  }
}

const html = readdirSync('.')
  .filter(file => file.endsWith('.html'))
  .map(file => readFileSync(file, 'utf8'))
  .find(content => content.includes('admin.js?v='));
if (!html) {
  console.error('관리자 자산을 참조하는 HTML을 찾을 수 없습니다.');
  process.exitCode = 1;
}
for (const required of ['admin.js?v=', 'admin.css?v=']) {
  if (!html?.includes(required)) {
    console.error(`index.html 필수 항목 누락: ${required}`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log(`관리자 코드 ${javascript.length}개 검증 통과`);
