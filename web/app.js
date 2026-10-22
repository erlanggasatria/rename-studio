const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="rename-token"]').content;
const cloudMode = document.querySelector('meta[name="rename-mode"]')?.content === 'cloud';
let cloudBatch = null;
const state = { files: [], selected: new Set(), folder: '', demo: false, filter: 'all', page: 0, busy: false, undo: null, ticket: null, action: 'rename', plan: [] };
const pageSize = 40;
function naturalCompare(a, b) {
  const parts = text => text.split(/([0-9]+)/).map((part, index) => index % 2 ? BigInt(part) : part.toLowerCase());
  const left = parts(a), right = parts(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return left.length - right.length;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function notice(message, type = '') {
  $('notice').textContent = message;
  $('notice').className = 'notice ' + type;
  $('notice').hidden = !message;
}
function size(bytes) {
  if (bytes < 1024) return bytes + ' B';
  for (const [divisor, unit] of [[1073741824, 'GB'], [1048576, 'MB'], [1024, 'KB']]) {
    if (bytes >= divisor) return (bytes / divisor).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' ' + unit;
  }
}
async function api(path, data) {
  if (cloudMode && path === 'preview') {
    return { ...window.RenameCloud.makePlan(state.files, data), ticket: crypto.randomUUID() };
  }
  const response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-Rename-Token': token, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Permintaan gagal.');
  return result;
}
async function task(work) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add('busy');
  const previous = new Map([...document.querySelectorAll('button, input, select, summary')].map(element => [element, element.disabled]));
  for (const element of previous.keys()) element.disabled = true;
  try { await work(); }
  catch (error) { notice(error.message || 'Tidak dapat terhubung. Jalankan server lokal kembali.', 'error'); }
  finally {
    state.busy = false;
    document.body.classList.remove('busy');
    for (const [element, disabled] of previous) element.disabled = disabled;
    render();
  }
}
function orderedFiles() {
  const files = [...state.files];
  const order = $('order').value;
  files.sort((a, b) => {
    const byName = naturalCompare(a.name, b.name);
    if (order.startsWith('date')) return (a.modified - b.modified || byName) * (order.endsWith('desc') ? -1 : 1);
    if (order === 'type') {
      const left = a.ext.toLowerCase(), right = b.ext.toLowerCase();
      return (left < right ? -1 : left > right ? 1 : 0) || byName;
    }
    return byName * (order.endsWith('desc') ? -1 : 1);
  });
  return files;
}
function preview() {
  const prefix = $('prefix').value;
  const start = Number($('start').value);
  const digitValue = $('digits').value;
  const width = Math.max(digitValue === 'auto' ? 2 : Number(digitValue), String(start + Math.max(0, state.selected.size - 1)).length);
  let error = '';
  if (!prefix.trim()) error = 'Isi nama custom terlebih dahulu.';
  else if (/[<>:"/\\|?*\x00-\x1f]/.test(prefix)) error = 'Nama mengandung karakter terlarang: < > : " / \\ | ? *';
  else if (!Number.isInteger(start) || start < 1 || start > 999999999) error = 'Nomor awal harus bilangan bulat 1–999999999.';
  const mapping = new Map();
  const chosen = orderedFiles().filter(file => state.selected.has(file.id));
  const occupied = new Set(state.files.filter(file => !state.selected.has(file.id)).map(file => file.name.toLowerCase()));
  chosen.forEach((file, index) => {
    const target = prefix + String(start + index).padStart(width, '0') + file.ext;
    mapping.set(file.id, target);
    if (target.length > 255) error = 'Nama baru terlalu panjang. Pendekkan nama custom.';
    if (occupied.has(target.toLowerCase())) error = 'Ada nama tujuan yang sudah dipakai file lain. Ubah pola atau pilihan file.';
  });
  return { mapping, width, start, error, changed: chosen.filter(file => mapping.get(file.id) !== file.name).length };
}
function filterFiles() {
  const query = $('search').value.toLowerCase().trim();
  return orderedFiles().filter(file => (state.filter === 'all' || file.ext.toLowerCase() === state.filter) && (!query || file.name.toLowerCase().includes(query)));
}
function renderFilters() {
  const container = $('filters');
  container.replaceChildren();
  const extensions = [...new Set(state.files.map(file => file.ext.toLowerCase()))].sort();
  if (state.filter !== 'all' && !extensions.includes(state.filter)) state.filter = 'all';
  for (const ext of ['all', ...extensions]) {
    const button = node('button', 'chip' + (state.filter === ext ? ' active' : ''), ext === 'all' ? 'Semua' : ext.slice(1).toUpperCase() || 'Tanpa ekstensi');
    button.setAttribute('aria-pressed', String(state.filter === ext));
    button.addEventListener('click', () => { state.filter = ext; state.page = 0; renderFilters(); render(); });
    container.append(button);
  }
}
function render() {
  const plan = preview();
  const selected = state.selected.size;
  const filtered = filterFiles();
  state.page = Math.min(state.page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const visible = filtered.slice(state.page * pageSize, (state.page + 1) * pageSize);
  $('fileCount').textContent = state.files.length + ' file';
  $('selectedLabel').textContent = state.files.length ? `${selected} dari ${state.files.length} file dipilih${state.filter !== 'all' || $('search').value ? ' · termasuk di luar filter' : ''}` : 'Belum ada file dipilih';
  const filteredSelected = filtered.filter(file => state.selected.has(file.id)).length;
  $('selectAll').disabled = !filtered.length || state.busy;
  $('selectAll').checked = filtered.length > 0 && filteredSelected === filtered.length;
  $('selectAll').indeterminate = filteredSelected > 0 && filteredSelected < filtered.length;
  $('selectAll').setAttribute('aria-label', 'Pilih semua file yang cocok dengan filter, di semua halaman');
  $('clearButton').disabled = !state.files.length || state.busy;
  $('reviewButton').disabled = !selected || !!plan.error || state.busy || !plan.changed;
  $('reviewButton').replaceChildren(document.createTextNode(state.demo ? 'Gunakan folder asli →' : cloudMode ? `Tinjau & buat skrip →` : `Tinjau ${selected || ''} perubahan →`));
  $('summaryTitle').textContent = state.files.length ? `${plan.changed} nama akan berubah.` : 'Siap saat kamu siap.';
  $('summaryDescription').textContent = state.demo ? 'Mode contoh · file asli belum dipilih.' : cloudMode ? 'Jalankan skrip unduhan di Windows untuk menerapkan.' : 'Perubahan belum dijalankan.';
  $('patternName').textContent = $('prefix').value || 'NamaCUSTOM';
  $('patternNumber').textContent = String(Number.isInteger(plan.start) && plan.start > 0 ? plan.start : 1).padStart(plan.width, '0');
  $('digitHint').textContent = selected ? `${plan.width} digit untuk ${selected} file terpilih. Ekstensi asli tetap.` : '10 file → 01–10 · 100 file → 001–100';
  $('validation').hidden = !plan.error;
  $('validation').textContent = plan.error;
  $('undoButton').disabled = !state.undo || state.busy;
  $('undoButton').title = state.undo ? `${state.undo.count} file di ${state.undo.folder}` : 'Belum ada batch untuk diurungkan';
  const body = $('fileRows');
  body.replaceChildren();
  for (const file of visible) {
    const isSelected = state.selected.has(file.id);
    const row = node('tr', isSelected ? '' : 'unselected');
    const choice = node('td', 'checkbox-col');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isSelected;
    checkbox.disabled = state.busy;
    checkbox.setAttribute('aria-label', 'Pilih ' + file.name);
    checkbox.addEventListener('change', () => { checkbox.checked ? state.selected.add(file.id) : state.selected.delete(file.id); render(); });
    choice.append(checkbox);
    const old = node('td');
    const fileCell = node('span', 'file-cell');
    const extension = file.ext.slice(1).toLowerCase();
    fileCell.append(node('span', 'file-type ' + extension.replace(/[^a-z0-9]/g, ''), extension.toUpperCase().slice(0, 4) || 'FILE'), node('span', 'old-name', file.name));
    old.append(fileCell);
    row.append(choice, old, node('td', 'arrow-col', isSelected ? '→' : '—'), node('td', 'new-name', isSelected ? plan.mapping.get(file.id) : 'Tidak diubah'), node('td', 'size-col', size(file.size)));
    body.append(row);
  }
  $('emptyState').hidden = filtered.length > 0;
  if (!filtered.length) {
    const isFiltered = state.files.length > 0;
    $('emptyState').querySelector('h3').textContent = isFiltered ? 'Tidak ada file yang cocok.' : state.folder ? 'Folder ini belum berisi file.' : 'File berantakan? Bereskan di sini.';
    $('emptyState').querySelector('p').textContent = isFiltered ? 'Coba kata pencarian atau format lain.' : state.folder ? 'Subfolder dan symlink tidak diproses. Pilih folder lain atau muat ulang.' : 'Pilih folder untuk melihat nama asli dan pratinjau nama barunya.';
  }
  $('pagination').hidden = !filtered.length;
  $('pageInfo').textContent = `${state.page * pageSize + 1}–${Math.min((state.page + 1) * pageSize, filtered.length)} dari ${filtered.length} file`;
  $('previousPage').disabled = state.page === 0 || state.busy;
  $('nextPage').disabled = (state.page + 1) * pageSize >= filtered.length || state.busy;
}
function load(result, demo = false) {
  if (result.cancelled) return;
  state.files = result.files;
  state.selected = new Set(result.files.map(file => file.id));
  state.folder = demo ? '' : result.folder;
  state.demo = demo;
  state.filter = 'all';
  state.page = 0;
  state.ticket = null;
  $('search').value = '';
  $('folderName').textContent = demo ? 'Contoh: Creative assets' : result.name;
  $('folderDescription').textContent = demo ? 'Simulasi 10 file. Pilih folder asli untuk melakukan rename.' : result.folder;
  $('folderMeta').hidden = false;
  $('folderMeta').textContent = `${result.files.length} file · ${size(result.files.reduce((total, file) => total + file.size, 0))} · Tanpa subfolder`;
  $('folderPath').value = demo ? '' : result.folder;
  $('folderButton').querySelector('span').textContent = demo ? 'Pilih folder asli' : 'Ganti folder';
  $('refreshButton').hidden = demo;
  renderFilters();
  render();
}
function showMapping(entries) {
  $('dialogMapping').replaceChildren();
  for (const item of entries) {
    const row = node('div', 'mapping-row');
    row.append(node('span', '', item.source), node('span', '', '→'), node('strong', '', item.target));
    $('dialogMapping').append(row);
  }
}
async function chooseFolder() {
  if (cloudMode) { $('browserFolder').click(); return; }
  notice('Pilih folder pada jendela yang terbuka. Jika jendelanya tidak terlihat, gunakan kolom lokasi folder.');
  await task(async () => { const result = await api('pick-folder', {}); if (!result.cancelled) { load(result); notice(''); } else notice('Pemilihan folder dibatalkan.'); });
}
$('folderButton').addEventListener('click', chooseFolder);
$('pathForm').addEventListener('submit', event => {
  event.preventDefault();
  task(async () => { load(await api('folder', { path: $('folderPath').value })); notice(''); });
});
$('refreshButton').addEventListener('click', () => {
  if (cloudMode) { chooseFolder(); return; }
  task(async () => { load(await api('folder', { path: state.folder })); notice('Folder dimuat ulang. Semua file kembali dipilih.'); });
});
$('browserFolder').addEventListener('change', () => {
  try {
    const result = window.RenameCloud.folderMetadata($('browserFolder').files);
    load(result);
    notice('Nama, ukuran, dan waktu file dibaca untuk pratinjau di browser. Isi file tidak diunggah. Setelah membuat skrip, pilih folder yang sama saat menjalankannya di Windows.');
  } catch (error) { notice(error.message, 'error'); }
  finally { $('browserFolder').value = ''; }
});
for (const id of ['prefix', 'start', 'digits', 'order']) $(id).addEventListener('input', () => { state.ticket = null; state.page = 0; render(); });
$('search').addEventListener('input', () => { state.page = 0; render(); });
$('selectAll').addEventListener('change', event => { for (const file of filterFiles()) event.target.checked ? state.selected.add(file.id) : state.selected.delete(file.id); render(); });
$('clearButton').addEventListener('click', () => {
  state.files = []; state.selected.clear(); state.folder = ''; state.demo = false; state.filter = 'all';
  $('folderName').textContent = 'Mulai dari satu folder';
  $('folderDescription').textContent = 'Pilih folder berisi file yang ingin kamu rapikan.';
  $('folderMeta').hidden = true; $('refreshButton').hidden = true; $('folderPath').value = '';
  $('folderButton').querySelector('span').textContent = 'Pilih folder';
  notice('Daftar dikosongkan. Tidak ada file yang dihapus.'); renderFilters(); render();
});
$('previousPage').addEventListener('click', () => { state.page--; render(); });
$('nextPage').addEventListener('click', () => { state.page++; render(); });
$('reviewButton').addEventListener('click', () => {
  if (state.demo) { chooseFolder(); return; }
  task(async () => {
    const result = await api('preview', { selected: [...state.selected], prefix: $('prefix').value, start: Number($('start').value), digits: $('digits').value, order: $('order').value });
    state.ticket = result.ticket; state.action = 'rename'; state.plan = result.plan;
    $('dialogEyebrow').textContent = 'SATU LANGKAH LAGI';
    $('dialogTitle').textContent = cloudMode ? `Buat skrip untuk ${result.changed} file?` : `Rename ${result.changed} file?`;
    $('dialogDescription').textContent = `${result.plan.length} file dipilih · ${result.digits} digit · ekstensi tetap.`;
    $('dialogPath').textContent = state.folder;
    $('dialogNote').textContent = cloudMode ? 'Web akan mengunduh skrip .cmd. File belum berubah. Klik dua kali skrip tersebut di Windows, pilih folder yang sama, lalu ketik RENAME untuk menerapkan. Untuk undo, jalankan skrip yang sama kembali.' : 'Nama file akan langsung berubah di folder asal. Batch terakhir dapat diurungkan selama file tidak berubah. Tutup aplikasi lain yang sedang mengedit file ini.';
    $('confirmButton').textContent = cloudMode ? 'Unduh skrip rename' : 'Ya, rename sekarang';
    showMapping(result.plan);
    notice(''); $('confirmDialog').showModal();
  });
});
$('undoButton').addEventListener('click', () => {
  if (!state.undo) return;
  state.action = 'undo';
  $('dialogEyebrow').textContent = 'KEMBALI KE NAMA AWAL';
  $('dialogTitle').textContent = cloudMode ? `Unduh skrip undo?` : `Urungkan ${state.undo.count} file?`;
  $('dialogDescription').textContent = 'Mengembalikan nama sebelum batch rename terakhir.';
  $('dialogPath').textContent = state.undo.folder;
  $('dialogMapping').replaceChildren();
  $('dialogNote').textContent = cloudMode ? 'Jalankan skrip undo di Windows dan pilih folder yang sama. Jurnal dari skrip rename harus tetap ada di folder tersebut. Web tidak dapat mengetahui apakah skrip rename sudah dijalankan.' : 'Undo ditolak jika file sudah berubah atau nama awal dipakai file lain. Isi file tidak diubah. Undo tidak dapat diulang setelah berhasil.';
  $('confirmButton').textContent = cloudMode ? 'Unduh skrip undo' : 'Ya, urungkan batch';
  $('confirmDialog').showModal();
});
$('cancelButton').addEventListener('click', () => $('confirmDialog').close());
$('confirmDialog').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
$('confirmButton').addEventListener('click', () => task(async () => {
  const undo = state.action === 'undo';
  // Close the dialog so request errors remain visible in the page status.
  $('confirmDialog').close();
  if (cloudMode) {
    const nextBatch = undo ? cloudBatch : { id: state.ticket, folderName: state.folder, entries: state.plan };
    await window.RenameCloud.download(nextBatch, undo ? 'undo' : 'rename');
    cloudBatch = nextBatch;
    state.undo = { folder: cloudBatch.folderName, count: cloudBatch.entries.filter(item => item.source !== item.target).length };
    notice(undo ? 'Skrip undo diunduh. Jalankan di Windows, pilih folder yang sama, lalu ketik UNDO.' : 'Skrip rename diunduh. File belum berubah: jalankan .cmd di Windows, pilih folder yang sama, lalu ketik RENAME. Simpan skrip dan jurnal untuk undo.');
    return;
  }
  const result = await api(undo ? 'undo' : 'apply', undo ? {} : { ticket: state.ticket });
  state.undo = result.undo;
  load(result);
  notice(undo ? `Selesai! ${result.count} file kembali ke nama awal.` : `Berhasil! ${result.count} nama file sudah dirapikan. Kamu bisa mengurungkan batch ini lewat tombol di bawah.`);
  $('reviewButton').focus();
}));
$('demoButton').addEventListener('click', () => {
  const names = ['asset_final_v3.ai', 'design_copy.eps', 'image_034.png', 'IMG_8472.jpg', 'mockup_new.png', 'photo_export.jpg', 'render_2026.mp4', 'untitled_01.ai', 'vector_rough.eps', 'video_final.mp4'];
  load({ files: names.map((name, index) => ({ id: name, name, ext: name.slice(name.lastIndexOf('.')), size: [3456000, 1245000, 734000, 2456000, 1452000, 5234000, 124567000, 1234000, 889000, 73567000][index], modified: 1792500000000 + index * 60000 })) }, true);
  notice('Mode contoh: ini hanya simulasi. Tidak ada file asli yang berubah.', 'demo');
});
$('helpButton').addEventListener('click', () => $('helpDialog').showModal());
$('mobileHelp').addEventListener('click', () => $('helpDialog').showModal());
$('closeHelp').addEventListener('click', () => $('helpDialog').close());
render();
if (cloudMode) {
  $('connection').replaceChildren(node('i'), document.createTextNode('Web · Skrip Windows'));
  document.querySelector('.path-details').hidden = true;
  $('undoButton').replaceChildren(document.createTextNode('Unduh skrip undo'));
  document.querySelector('.steps>span:last-child').lastChild.textContent = ' Tinjau & unduh skrip';
  const list = $('helpDialog').querySelector('.help-list');
  list.replaceChildren();
  for (const [title, text] of [
    ['Pilih folder & atur pola', 'Browser membaca nama, ukuran, dan waktu file di tingkat pertama folder. Isi file tidak diunggah. Subfolder dilewati.'],
    ['Unduh skrip', 'Periksa pratinjau lalu klik Unduh skrip rename. Mengunduh skrip belum mengubah file.'],
    ['Jalankan di Windows', 'Klik dua kali file .cmd, pilih folder yang sama, periksa daftar nama, lalu ketik RENAME. Tidak perlu Python atau upload.'],
    ['Urungkan jika perlu', 'Jalankan ulang .cmd yang sama, pilih folder yang sama, lalu ketik UNDO. Jurnal .rename-studio-*.json harus tetap tersimpan di folder aset.']
  ]) { const item = node('li'); item.append(node('strong', '', title), node('p', '', text)); list.append(item); }
  $('helpDialog').querySelector('.dialog-note').textContent = 'Skrip hanya mengganti nama; tidak menyalin isi file. File yang berubah sejak dipilih atau nama tujuan yang bentrok akan ditolak. Setelah menjalankan skrip, pilih folder kembali di web untuk melihat hasil terbaru.';
  notice('Versi web: pilih folder, atur nama, lalu unduh skrip untuk dijalankan di Windows. Semua file tetap di komputer; web tidak langsung menerapkan rename.');
} else api('status').then(result => {
  state.undo = result.undo;
  $('connection').replaceChildren(node('i'), document.createTextNode('Berjalan lokal'));
  render();
}).catch(() => {
  $('connection').textContent = 'Server tidak terhubung';
  notice('Jalankan “Mulai Rename Studio.bat”, lalu buka alamat lokal yang muncul. Halaman ini membutuhkan server lokal untuk mengganti nama file.', 'error');
});
