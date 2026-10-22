(function (root) {
  'use strict';
  function natural(a, b) {
    const parts = value => value.split(/([0-9]+)/).map((item, i) => i % 2 ? BigInt(item) : item.toLowerCase());
    const left = parts(a), right = parts(b);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] < right[i]) return -1;
      if (left[i] > right[i]) return 1;
    }
    return left.length - right.length;
  }
  function validateName(name) {
    if (!name || name.length > 255 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw new Error('Nama file tidak valid untuk Windows: ' + name);
  }
  function makePlan(files, options) {
    const { prefix, start, digits = 'auto', order = 'name', selected } = options;
    if (typeof prefix !== 'string' || !prefix.trim()) throw new Error('Isi nama custom terlebih dahulu.');
    if (!Number.isSafeInteger(start) || start < 1 || start > 999999999) throw new Error('Nomor awal tidak valid.');
    if (!['auto', '2', '3', '4', '5', '6'].includes(digits)) throw new Error('Jumlah digit tidak valid.');
    if (!['name', 'name-desc', 'date', 'date-desc', 'type'].includes(order)) throw new Error('Urutan tidak valid.');
    if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length) throw new Error('Pilih file yang ingin diubah.');
    const ids = new Set(selected);
    const chosen = files.filter(file => ids.has(file.id));
    if (chosen.length !== ids.size) throw new Error('Pilihan file tidak ditemukan. Pilih folder kembali.');
    chosen.sort((a, b) => {
      const name = natural(a.name, b.name);
      if (order.startsWith('date')) return (a.modified - b.modified || name) * (order.endsWith('desc') ? -1 : 1);
      if (order === 'type') { const x = a.ext.toLowerCase(), y = b.ext.toLowerCase(); return (x < y ? -1 : x > y ? 1 : 0) || name; }
      return name * (order.endsWith('desc') ? -1 : 1);
    });
    const width = Math.max(digits === 'auto' ? 2 : Number(digits), String(start + chosen.length - 1).length);
    const occupied = new Set(files.filter(file => !ids.has(file.id)).map(file => file.name.toLowerCase()));
    const names = new Set();
    const plan = chosen.map((file, index) => {
      validateName(file.name);
      const target = prefix + String(start + index).padStart(width, '0') + file.ext;
      validateName(target);
      if (names.has(target.toLowerCase()) || occupied.has(target.toLowerCase())) throw new Error('Nama tujuan sudah digunakan: ' + target);
      names.add(target.toLowerCase());
      if (!Number.isSafeInteger(file.size) || file.size < 0 || !Number.isFinite(file.modified)) throw new Error('Metadata file tidak valid.');
      return { source: file.name, target, size: file.size, modified: Math.floor(file.modified) };
    });
    return { plan, digits: width, changed: plan.filter(item => item.source !== item.target).length };
  }
  function folderMetadata(fileList) {
    const all = Array.from(fileList);
    const names = new Set();
    const files = [];
    const folderName = all[0]?.webkitRelativePath?.split('/')[0] || 'Folder pilihan';
    for (const file of all) {
      const relative = file.webkitRelativePath || file.name;
      if (relative.split('/').length > 2 || file.name.startsWith('.rename-studio-')) continue;
      if (names.has(file.name.toLowerCase())) throw new Error('Nama file duplikat: ' + file.name);
      names.add(file.name.toLowerCase());
      const dot = file.name.lastIndexOf('.');
      files.push({ id: file.name, name: file.name, ext: dot > 0 ? file.name.slice(dot) : '', size: file.size, modified: file.lastModified });
    }
    return { name: folderName, folder: folderName, files };
  }
  function base64UTF8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  function command(template, batch, mode = 'rename') {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(batch.id) || !['rename', 'undo'].includes(mode)) throw new Error('Identitas batch tidak valid.');
    for (const item of batch.entries) { validateName(item.source); validateName(item.target); }
    const payload = base64UTF8(JSON.stringify({ id: batch.id, folderName: batch.folderName, entries: batch.entries, mode }));
    if (!template.includes('__RENAME_PLAN_BASE64__')) throw new Error('Template skrip tidak valid.');
    const script = template.replace('__RENAME_PLAN_BASE64__', payload);
    // The payload is data (Base64 JSON), never inserted as executable PowerShell.
    const wrapper = ['@echo off', 'setlocal', 'set "RENAME_STUDIO_SELF=%~f0"', 'powershell.exe -NoProfile -Command "$text=[IO.File]::ReadAllText($env:RENAME_STUDIO_SELF); $marker=\'#\'+\' RENAME_STUDIO_POWERSHELL\'; & ([ScriptBlock]::Create($text.Substring($text.IndexOf($marker)+$marker.Length)))"', 'set "RENAME_STUDIO_EXIT=%errorlevel%"', 'echo.', 'pause', 'exit /b %RENAME_STUDIO_EXIT%', '# RENAME_STUDIO_POWERSHELL', script];
    return wrapper.join('\r\n');
  }
  async function download(batch, mode) {
    const response = await fetch('/rename-template.ps1');
    if (!response.ok) throw new Error('Template skrip belum tersedia. Muat ulang halaman.');
    const content = command(await response.text(), batch, mode);
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${mode === 'undo' ? 'Undo' : 'Rename'}-Studio-${batch.id.slice(0, 8)}.cmd`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const api = { makePlan, folderMetadata, command, download };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RenameCloud = api;
})(typeof window === 'undefined' ? globalThis : window);
