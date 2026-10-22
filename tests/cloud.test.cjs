const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cloud = require('../web/cloud.js');
const template = fs.readFileSync(path.join(__dirname, '../web/rename-template.ps1'), 'utf8');
const options = (files, extra = {}) => ({ prefix: 'EV_SB', start: 1, selected: files.map(file => file.id), ...extra });
const meta = (name, size = 1, modified = 1000) => ({ id: name, name, ext: path.extname(name), size, modified });

test('10 files use two digits; 100 files use three digits', () => {
  for (const count of [10, 100]) {
    const files = Array.from({ length: count }, (_, i) => meta(`random${i + 1}.ai`));
    const result = cloud.makePlan(files, options(files));
    assert.equal(result.plan[0].target, count === 10 ? 'EV_SB01.ai' : 'EV_SB001.ai');
    assert.equal(result.plan.at(-1).target, `EV_SB${count}.ai`);
  }
});
test('prefix, extension casing, no extension, natural sorting, and start boundary', () => {
  const files = [meta('a10.JPG'), meta('a2.ai'), meta('a1')];
  const result = cloud.makePlan(files, options(files, { prefix: 'Nama - ', start: 99 }));
  assert.deepEqual(result.plan.map(item => item.target), ['Nama - 099', 'Nama - 100.ai', 'Nama - 101.JPG']);
});
test('subset uses selected count; conflicts with unselected files are rejected', () => {
  const files = [meta('a.ai'), meta('b.ai'), meta('ev_sb01.ai')];
  assert.throws(() => cloud.makePlan(files, options(files, { selected: ['a.ai'] })), /digunakan/);
});
test('all configured order options work', () => {
  const files = [meta('b.ai', 1, 2000), meta('a.png', 1, 1000)];
  assert.equal(cloud.makePlan(files, options(files, { order: 'name-desc' })).plan[0].source, 'b.ai');
  assert.equal(cloud.makePlan(files, options(files, { order: 'date' })).plan[0].source, 'a.png');
  assert.equal(cloud.makePlan(files, options(files, { order: 'date-desc' })).plan[0].source, 'b.ai');
  assert.equal(cloud.makePlan(files, options(files, { order: 'type' })).plan[0].source, 'b.ai');
});
test('invalid inputs and path traversal are rejected', () => {
  const files = [meta('a.ai')];
  for (const prefix of ['', '../', 'x:', 'x\n']) assert.throws(() => cloud.makePlan(files, options(files, { prefix })));
  for (const start of [0, -1, 1.2, 1e12]) assert.throws(() => cloud.makePlan(files, options(files, { start })));
  assert.throws(() => cloud.makePlan(files, options(files, { selected: ['missing'] })));
  assert.throws(() => cloud.makePlan(files, options(files, { selected: ['a.ai', 'a.ai'] })));
});
test('folder metadata skips nested files and app journals without reading contents', () => {
  const files = [
    { name: 'a.ai', size: 10, lastModified: 5000, webkitRelativePath: 'Assets/a.ai' },
    { name: 'b.png', size: 20, lastModified: 5000, webkitRelativePath: 'Assets/Nested/b.png' },
    { name: '.rename-studio-abc.json', size: 30, lastModified: 5000, webkitRelativePath: 'Assets/.rename-studio-abc.json' }
  ];
  assert.deepEqual(cloud.folderMetadata(files), { name: 'Assets', folder: 'Assets', files: [meta('a.ai', 10, 5000)] });
});
test('untrusted filenames are encoded as data, including Unicode and PowerShell metacharacters', () => {
  const files = [meta("$([IO.File]::Delete('x')).ai")];
  // A colon is invalid in Windows filenames and must be rejected.
  assert.throws(() => cloud.makePlan(files, options(files)));
  const good = [meta("desain '雪' $money & (a).ai")];
  const result = cloud.makePlan(good, options(good));
  const cmd = cloud.command(template, { id: 'test-encoding', folderName: 'Assets', entries: result.plan });
  assert.ok(!cmd.includes(good[0].name));
  const payload = cmd.match(/FromBase64String\('([^']+)'\)/)[1];
  assert.equal(JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).entries[0].source, good[0].name);
  assert.ok(!cmd.includes('ExecutionPolicy'));
});

function fixture(names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-studio-cloud-'));
  const folder = path.join(root, 'Assets'); fs.mkdirSync(folder);
  for (const [index, name] of names.entries()) fs.writeFileSync(path.join(folder, name), `original-contents-${index}-${name}`);
  const files = names.map(name => { const stat = fs.statSync(path.join(folder, name)); return meta(name, stat.size, Math.floor(stat.mtimeMs)); });
  const batch = { id: 'test-' + Date.now(), folderName: 'Assets', entries: cloud.makePlan(files, options(files)).plan };
  return { root, folder, files, batch };
}
function runScript(fixture, mode = 'rename') {
  const cmd = cloud.command(template, fixture.batch, mode);
  const marker = '# RENAME_STUDIO_POWERSHELL';
  const ps = cmd.slice(cmd.indexOf(marker) + marker.length).trimStart();
  const file = path.join(fixture.root, 'generated.ps1'); fs.writeFileSync(file, ps);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:RENAME_TEST_SCRIPT))) -Folder $env:RENAME_TEST_FOLDER -Yes'], { env: { ...process.env, RENAME_TEST_SCRIPT: file, RENAME_TEST_FOLDER: fixture.folder }, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error) throw result.error;
  return result;
}
const windowsOnly = { skip: process.platform !== 'win32' };
test('generated Windows script renames and undoes 100 mixed-format files without changing bytes', windowsOnly, () => {
  const names = Array.from({ length: 100 }, (_, i) => `random${i + 1}${['.ai', '.eps', '.png', '.mp4', '.JPG'][i % 5]}`);
  const f = fixture(names);
  try {
    const before = new Map(names.map(name => [name, fs.readFileSync(path.join(f.folder, name))]));
    const rename = runScript(f);
    assert.equal(rename.status, 0, rename.stdout + rename.stderr);
    for (const item of f.batch.entries) assert.deepEqual(fs.readFileSync(path.join(f.folder, item.target)), before.get(item.source));
    const undo = runScript(f, 'undo');
    assert.equal(undo.status, 0, undo.stdout + undo.stderr);
    for (const name of names) assert.deepEqual(fs.readFileSync(path.join(f.folder, name)), before.get(name));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
test('Windows script rejects file changes after browser preview', windowsOnly, () => {
  const f = fixture(['a.ai']);
  try {
    fs.appendFileSync(path.join(f.folder, 'a.ai'), 'edited');
    const result = runScript(f);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(fs.existsSync(path.join(f.folder, 'a.ai')));
    assert.ok(!fs.existsSync(path.join(f.folder, 'EV_SB01.ai')));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
test('Windows script rejects collision created after preview', windowsOnly, () => {
  const f = fixture(['a.ai']);
  try {
    fs.writeFileSync(path.join(f.folder, 'EV_SB01.ai'), 'unrelated');
    const result = runScript(f);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(path.join(f.folder, 'EV_SB01.ai'), 'utf8'), 'unrelated');
    assert.ok(fs.existsSync(path.join(f.folder, 'a.ai')));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
test('Windows undo rejects an edited renamed file', windowsOnly, () => {
  const f = fixture(['a.ai']);
  try {
    const result = runScript(f); assert.equal(result.status, 0, result.stdout + result.stderr);
    fs.appendFileSync(path.join(f.folder, 'EV_SB01.ai'), 'edited');
    assert.equal(runScript(f, 'undo').status, 1);
    assert.ok(fs.existsSync(path.join(f.folder, 'EV_SB01.ai')));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
test('rerunning the same Windows script offers undo and restores originals', windowsOnly, () => {
  const f = fixture(['a.ai', 'b.png']);
  try {
    const result = runScript(f); assert.equal(result.status, 0, result.stdout + result.stderr);
    const rerun = runScript(f); assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
    assert.ok(fs.existsSync(path.join(f.folder, 'a.ai')));
    assert.ok(fs.existsSync(path.join(f.folder, 'b.png')));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
test('Windows script recovers a simulated interrupted transaction from journal', windowsOnly, () => {
  const f = fixture(['a.ai', 'b.png']);
  try {
    const result = runScript(f); assert.equal(result.status, 0, result.stdout + result.stderr);
    const journal = path.join(f.folder, '.rename-studio-' + f.batch.id + '.json');
    fs.writeFileSync(journal, fs.readFileSync(journal, 'utf8').replace('"Status":  "complete"', '"Status":  "pending"'));
    const recovery = runScript(f); assert.equal(recovery.status, 0, recovery.stdout + recovery.stderr);
    assert.ok(fs.existsSync(path.join(f.folder, 'a.ai')));
    assert.ok(fs.existsSync(path.join(f.folder, 'b.png')));
    assert.match(fs.readFileSync(journal, 'utf8'), /rolled-back/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
