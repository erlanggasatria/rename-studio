import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import rename_core as core
from server import App


class RenameTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = self.root / 'assets'
        self.folder.mkdir()
        self.engine = core.Engine(self.root / 'runtime')

    def tearDown(self):
        self.temp.cleanup()

    def files(self, *names):
        for name in names:
            (self.folder / name).write_bytes(('contents:' + name).encode())

    def plan(self, prefix='EV_SB', start=1, digits='auto', selected=None, order='name'):
        folder, files = core.scan(self.folder)
        return core.make_plan(folder, files, selected or [file['id'] for file in files], prefix, start, digits, order)[0]

    def names(self):
        return sorted(file.name for file in self.folder.iterdir())

    def test_ten_files_two_digits_and_original_extensions(self):
        names = ['random%d%s' % (i, ext) for i, ext in enumerate(['.ai', '.eps', '.png', '.mp4', '.JPG', '.svg', '.pdf', '.webp', '.zip', ''])]
        self.files(*names)
        plan = self.plan()
        originals = {item['target']: (self.folder / item['source']).read_bytes() for item in plan}
        self.assertEqual(self.engine.execute(self.folder, plan), 10)
        self.assertIn('EV_SB01.ai', self.names())
        self.assertIn('EV_SB10', self.names())
        self.assertIn('EV_SB05.JPG', self.names())
        for target, content in originals.items():
            self.assertEqual((self.folder / target).read_bytes(), content)
        self.assertEqual(self.engine.undo(), 10)
        self.assertEqual(self.names(), sorted(names))

    def test_hundred_files_three_digits(self):
        self.files(*(f'random{i}.ai' for i in range(100)))
        plan = self.plan('NamaCUSTOM')
        self.assertEqual(plan[0]['target'], 'NamaCUSTOM001.ai')
        self.assertEqual(plan[-1]['target'], 'NamaCUSTOM100.ai')

    def test_start_crossing_digit_boundary(self):
        self.files('x.png', 'y.png')
        self.assertEqual([item['target'] for item in self.plan(start=99)], ['EV_SB099.png', 'EV_SB100.png'])

    def test_minimum_digits_and_spaces(self):
        self.files('x.ai')
        self.assertEqual(self.plan('Batch - ', digits='4')[0]['target'], 'Batch - 0001.ai')

    def test_natural_sort(self):
        self.files('file10.ai', 'file2.ai', 'file1.ai')
        self.assertEqual([item['source'] for item in self.plan()], ['file1.ai', 'file2.ai', 'file10.ai'])

    def test_subset(self):
        self.files('a.ai', 'b.ai')
        self.engine.execute(self.folder, self.plan(selected=['b.ai']))
        self.assertEqual(self.names(), ['EV_SB01.ai', 'a.ai'])

    def test_collision_with_file(self):
        self.files('a.ai', 'EV_SB01.ai')
        with self.assertRaises(core.RenameError):
            self.plan(selected=['a.ai'])
        self.assertEqual(len(self.names()), 2)

    def test_collision_with_directory(self):
        self.files('a.ai')
        (self.folder / 'EV_SB01.ai').mkdir()
        with self.assertRaises(core.RenameError):
            self.plan()

    def test_case_insensitive_collision(self):
        self.files('a.AI', 'ev_sb01.ai')
        with self.assertRaises(core.RenameError):
            self.plan(selected=['a.AI'])

    def test_swap_cycle_and_undo(self):
        self.files('EV_SB01.ai', 'EV_SB02.ai')
        before = {name: (self.folder / name).read_bytes() for name in self.names()}
        self.engine.execute(self.folder, self.plan(order='name-desc'))
        self.assertEqual((self.folder / 'EV_SB01.ai').read_bytes(), before['EV_SB02.ai'])
        self.engine.undo()
        for name, contents in before.items():
            self.assertEqual((self.folder / name).read_bytes(), contents)

    def test_stale_preview_file_modified(self):
        self.files('a.ai')
        plan = self.plan()
        (self.folder / 'a.ai').write_bytes(b'changed after preview')
        with self.assertRaises(core.RenameError):
            self.engine.execute(self.folder, plan)
        self.assertEqual(self.names(), ['a.ai'])

    def test_collision_appears_after_preview(self):
        self.files('a.ai')
        plan = self.plan()
        self.files('EV_SB01.ai')
        with self.assertRaises(core.RenameError):
            self.engine.execute(self.folder, plan)

    def test_modified_file_rejects_undo(self):
        self.files('a.ai')
        self.engine.execute(self.folder, self.plan())
        (self.folder / 'EV_SB01.ai').write_bytes(b'modified')
        with self.assertRaises(core.RenameError):
            self.engine.undo()
        self.assertEqual((self.folder / 'EV_SB01.ai').read_bytes(), b'modified')

    def test_undo_does_not_overwrite_new_file(self):
        self.files('a.ai')
        self.engine.execute(self.folder, self.plan())
        (self.folder / 'a.ai').write_bytes(b'new independent file')
        with self.assertRaises(core.RenameError):
            self.engine.undo()
        self.assertEqual((self.folder / 'a.ai').read_bytes(), b'new independent file')

    def test_mid_batch_error_rolls_back(self):
        self.files('a.ai', 'b.ai', 'c.png')
        plan = self.plan()
        real_move = core.move_no_replace
        count = 0
        def failing_move(source, target):
            nonlocal count
            count += 1
            if count == 5:
                raise PermissionError('Simulated locked file')
            return real_move(source, target)
        with patch.object(core, 'move_no_replace', failing_move):
            with self.assertRaises(core.RenameError):
                self.engine.execute(self.folder, plan)
        self.assertEqual(self.names(), ['a.ai', 'b.ai', 'c.png'])
        self.assertFalse(self.engine.journal.exists())

    def test_first_file_locked_leaves_originals(self):
        self.files('a.ai', 'b.ai')
        with patch.object(core, 'move_no_replace', side_effect=PermissionError('locked')):
            with self.assertRaises(core.RenameError):
                self.engine.execute(self.folder, self.plan())
        self.assertFalse(self.engine.journal.exists())
        self.assertEqual(self.names(), ['a.ai', 'b.ai'])

    def test_restart_recovers_interrupted_batch(self):
        self.files('a.ai', 'b.ai')
        entries = [dict(item, temp='.rename-studio-test' + str(index)) for index, item in enumerate(self.plan())]
        record = dict(folder=str(self.folder), entries=entries)
        self.engine.save(self.engine.journal, record)
        for item in entries:
            core.move_no_replace(self.folder / item['source'], self.folder / item['temp'])
        core.move_no_replace(self.folder / entries[0]['temp'], self.folder / entries[0]['target'])
        core.Engine(self.root / 'runtime')
        self.assertEqual(self.names(), ['a.ai', 'b.ai'])

    def test_history_survives_restart(self):
        self.files('a.ai')
        self.engine.execute(self.folder, self.plan())
        engine = core.Engine(self.root / 'runtime')
        self.assertEqual(engine.last_batch()['count'], 1)
        engine.undo()
        self.assertEqual(self.names(), ['a.ai'])

    def test_noop_preserves_last_batch(self):
        self.files('a.ai')
        self.engine.execute(self.folder, self.plan())
        self.assertEqual(self.engine.execute(self.folder, self.plan()), 0)
        self.assertEqual(self.engine.last_batch()['count'], 1)

    def test_subfolders_not_included(self):
        self.files('a.ai')
        (self.folder / 'nested').mkdir()
        (self.folder / 'nested' / 'secret.png').write_bytes(b'nested')
        self.assertEqual(len(core.scan(self.folder)[1]), 1)

    def test_invalid_names_and_options(self):
        self.files('a.ai')
        for prefix in ['', ' ', '../', 'bad:', 'a|b', 'x\x00']:
            with self.subTest(prefix=repr(prefix)), self.assertRaises(core.RenameError):
                self.plan(prefix)
        for start in [0, -1, 1.5, True, 1000000000]:
            with self.subTest(start=start), self.assertRaises(core.RenameError):
                self.plan(start=start)

    def test_ticket_single_use(self):
        self.files('a.ai')
        app = App(self.root / 'app-runtime')
        app.load(self.folder)
        preview = app.route('/api/preview', dict(selected=['a.ai'], prefix='Test', start=1))
        app.route('/api/apply', dict(ticket=preview['ticket']))
        with self.assertRaises(core.RenameError):
            app.route('/api/apply', dict(ticket=preview['ticket']))

    def test_switching_folder_invalidates_preview(self):
        self.files('a.ai')
        app = App(self.root / 'app-runtime')
        app.load(self.folder)
        preview = app.route('/api/preview', dict(selected=['a.ai'], prefix='Test', start=1))
        app.load(self.folder)
        with self.assertRaises(core.RenameError):
            app.route('/api/apply', dict(ticket=preview['ticket']))


if __name__ == '__main__':
    unittest.main()
