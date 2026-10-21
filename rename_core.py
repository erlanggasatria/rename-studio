"""Filesystem-only rename engine. Never reads file contents or replaces a file."""
import json
import os
import re
import stat
import uuid
from pathlib import Path


class RenameError(ValueError):
    pass


def fingerprint(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise RenameError(f"Bukan file biasa: {path.name}")
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns]


def matches(path, expected):
    try:
        return fingerprint(path) == expected
    except (OSError, RenameError):
        return False


def natural_key(value):
    return [int(part) if part.isdigit() else part.lower()
            for part in re.split(r"([0-9]+)", value)]


def scan(folder):
    path = Path(folder).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise RenameError("Lokasi yang dipilih bukan folder.")
    files = []
    for item in path.iterdir():
        if item.is_symlink() or not item.is_file() or item.name.startswith('.rename-studio-'):
            continue
        mark = fingerprint(item)
        files.append(dict(id=item.name, name=item.name, ext=item.suffix,
                          size=mark[2], modified=mark[3] / 1_000_000, fingerprint=mark))
    files.sort(key=lambda item: natural_key(item['name']))
    return path, files


def validate_name(name):
    if not name or len(name) > 255 or re.search(r'[<>:"/\\|?*\x00-\x1f]', name):
        raise RenameError("Nama kosong, terlalu panjang, atau mengandung karakter terlarang: < > : \" / \\ | ? *")
    if name.endswith((' ', '.')) or name in ('.', '..'):
        raise RenameError("Nama tidak boleh diakhiri titik atau spasi.")
    if re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name, re.I):
        raise RenameError("Nama tersebut dicadangkan oleh Windows.")


def make_plan(folder, files, selected, prefix, start=1, digits='auto', order='name'):
    if not isinstance(prefix, str) or not prefix.strip():
        raise RenameError("Isi nama custom terlebih dahulu.")
    if not isinstance(start, int) or isinstance(start, bool) or not 1 <= start <= 999999999:
        raise RenameError("Nomor awal harus bilangan bulat 1–999999999.")
    if digits not in ('auto', '2', '3', '4', '5', '6'):
        raise RenameError("Pilihan digit tidak valid.")
    if order not in ('name', 'name-desc', 'date', 'date-desc', 'type'):
        raise RenameError("Urutan tidak valid.")
    if not isinstance(selected, list) or not selected or len(selected) != len(set(selected)):
        raise RenameError("Pilih setidaknya satu file. Pilihan tidak boleh duplikat.")
    by_id = {item['id']: item for item in files}
    if any(item not in by_id for item in selected):
        raise RenameError("Pilihan sudah berubah. Muat ulang folder.")
    chosen = [by_id[item] for item in selected]
    if order.startswith('date'):
        chosen.sort(key=lambda item: (item['modified'], natural_key(item['name'])), reverse=order.endswith('desc'))
    elif order == 'type':
        chosen.sort(key=lambda item: (item['ext'].lower(), natural_key(item['name'])))
    else:
        chosen.sort(key=lambda item: natural_key(item['name']), reverse=order.endswith('desc'))
    width = max(2 if digits == 'auto' else int(digits), len(str(start + len(chosen) - 1)))
    plan = []
    for index, item in enumerate(chosen, start):
        target = prefix + str(index).zfill(width) + item['ext']
        validate_name(target)
        plan.append(dict(source=item['name'], target=target, fingerprint=item['fingerprint']))
    validate_plan(Path(folder), plan)
    return plan, width


def validate_plan(folder, plan):
    sources = {item['source'].casefold() for item in plan}
    targets = [item['target'].casefold() for item in plan]
    if len(sources) != len(plan) or len(set(targets)) != len(plan):
        raise RenameError("Ada nama file duplikat (termasuk perbedaan huruf besar/kecil).")
    occupied = {entry.name.casefold() for entry in folder.iterdir()}
    for item in plan:
        validate_name(item['source'])
        validate_name(item['target'])
        if not matches(folder / item['source'], item['fingerprint']):
            raise RenameError(f"File berubah atau hilang: {item['source']}. Muat ulang folder.")
        if item['target'].casefold() in occupied - sources:
            raise RenameError(f"Nama tujuan sudah digunakan: {item['target']}. Ubah nama atau pilihan file.")


def move_no_replace(source, target):
    # Windows rename fails if the target exists. POSIX uses an exclusive hard link.
    if os.name == 'nt':
        os.rename(source, target)
    else:
        os.link(source, target, follow_symlinks=False)
        try:
            os.unlink(source)
        except OSError:
            os.unlink(target)
            raise


class Engine:
    def __init__(self, runtime):
        self.runtime = Path(runtime)
        self.runtime.mkdir(parents=True, exist_ok=True)
        self.journal = self.runtime / 'pending.json'
        self.history = self.runtime / 'last-batch.json'
        if self.journal.exists():
            record = json.loads(self.journal.read_text(encoding='utf-8'))
            if record.get('committed'):
                self.finish(record)
            else:
                self.rollback(record)
            self.journal.unlink()

    def finish(self, record):
        if record.get('undo'):
            self.history.unlink(missing_ok=True)
        else:
            self.save(self.history, record)

    @staticmethod
    def save(path, record):
        temporary = path.with_suffix('.tmp')
        with temporary.open('w', encoding='utf-8') as handle:
            json.dump(record, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)

    def rollback(self, record):
        folder = Path(record['folder'])
        # Stage every surviving file again so cycles cannot overwrite originals.
        for item in record['entries']:
            temp = folder / item['temp']
            if matches(folder / item['source'], item['fingerprint']):
                continue
            if matches(temp, item['fingerprint']):
                continue
            current = next((folder / item[key] for key in ('source', 'target')
                            if matches(folder / item[key], item['fingerprint'])), None)
            if current is None:
                raise RenameError("Pemulihan perlu diperiksa manual; file berubah atau hilang. Jurnal tetap disimpan di .runtime/pending.json.")
            move_no_replace(current, temp)
        for item in record['entries']:
            if matches(folder / item['source'], item['fingerprint']):
                continue
            move_no_replace(folder / item['temp'], folder / item['source'])

    def execute(self, folder, plan, undo=False):
        folder = Path(folder)
        if self.journal.exists():
            raise RenameError("Ada transaksi yang belum pulih. Tutup aplikasi dan jalankan kembali untuk pemulihan.")
        validate_plan(folder, plan)
        changed = [item for item in plan if item['source'] != item['target']]
        if not changed:
            return 0
        record = dict(folder=str(folder), undo=undo, entries=[dict(item, temp=f'.rename-studio-{uuid.uuid4().hex}') for item in changed])
        self.save(self.journal, record)
        try:
            for item in record['entries']:
                if not matches(folder / item['source'], item['fingerprint']):
                    raise RenameError(f"File berubah: {item['source']}")
                move_no_replace(folder / item['source'], folder / item['temp'])
            for item in record['entries']:
                move_no_replace(folder / item['temp'], folder / item['target'])
            committed = dict(record, committed=True)
            self.save(self.journal, committed)
        except Exception as error:
            try:
                self.rollback(record)
                self.journal.unlink()
            except Exception as recovery:
                raise RenameError(f"Proses berhenti. Pemulihan belum lengkap: {recovery}") from error
            raise RenameError(f"Rename dibatalkan; nama awal dipulihkan. {error}") from error
        self.finish(committed)
        self.journal.unlink()
        return len(changed)

    def last_batch(self):
        if not self.history.exists():
            return None
        record = json.loads(self.history.read_text(encoding='utf-8'))
        return dict(folder=record['folder'], count=len(record['entries']))

    def undo(self):
        if not self.history.exists():
            raise RenameError("Belum ada batch yang dapat diurungkan.")
        record = json.loads(self.history.read_text(encoding='utf-8'))
        plan = [dict(source=item['target'], target=item['source'], fingerprint=item['fingerprint']) for item in record['entries']]
        return self.execute(record['folder'], plan, undo=True)
