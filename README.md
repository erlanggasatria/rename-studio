# Rename Studio

Web lokal untuk mengganti nama banyak file dalam satu folder menjadi nama custom + nomor berurutan. Isi file dan ekstensi asli tidak diubah; file tidak diunggah atau disalin ke server cloud.

## Mulai di Windows

1. Pastikan **Python 3.10 atau lebih baru** terpasang (termasuk Tkinter untuk tombol pemilih folder).
2. Klik dua kali **Mulai Rename Studio.bat**. Browser akan terbuka di **http://127.0.0.1:8765**.
3. Pilih folder, atau masukkan lokasinya pada kolom **Atau masukkan lokasi folder**.
4. Atur nama custom, nomor awal, digit, dan urutan. Hilangkan centang file yang tidak ingin diubah.
5. Klik **Tinjau perubahan**, periksa pasangan nama, lalu **Ya, rename sekarang**.

Biarkan jendela server tetap terbuka selama menggunakan web. Untuk menutup, tekan **Ctrl+C** pada jendela tersebut. Tidak perlu Node.js, npm, internet, API key, atau instalasi package Python tambahan.

Jika port 8765 dipakai program lain, jalankan dari folder proyek:

```powershell
python server.py --port 8766
```

Satu checkout hanya dapat menjalankan satu server sekaligus untuk melindungi jurnal rename.

## Contoh pola

| Nama custom | File terpilih | Hasil tanpa ekstensi |
| --- | ---: | --- |
| `EV_SB` | 10 | `EV_SB01` … `EV_SB10` |
| `NamaCUSTOM` | 100 | `NamaCUSTOM001` … `NamaCUSTOM100` |
| `Produk - ` | 5 | `Produk - 01` … `Produk - 05` |

Nomor berlaku global untuk seluruh file yang dipilih, termasuk format yang berbeda. Jika menginginkan spasi, `_`, atau `-`, sertakan dalam nama custom. Minimum digit otomatis adalah dua; jumlah digit bertambah saat nomor terakhir membutuhkannya, termasuk jika mulai dari 99. Nama baru mempertahankan ekstensi dan besar/kecil huruf ekstensi (`.JPG` tetap `.JPG`). Untuk nama multi-ekstensi seperti `.tar.gz`, hanya ekstensi terakhir `.gz` yang dipertahankan.

## Fitur

- Semua format file, termasuk `.ai`, `.eps`, `.png`, `.jpg`, `.mp4`, dan file tanpa ekstensi.
- Preview langsung, filter format, pencarian nama asli, pilihan per file, dan pagination 40 baris.
- Checkbox di atas tabel memilih seluruh file yang cocok dengan filter di semua halaman. File yang dipilih di luar filter tetap masuk batch; jumlah global ditampilkan.
- Urutan nama natural (`file2` sebelum `file10`), tanggal, atau jenis file.
- Pemeriksaan bentrok juga memperhitungkan subfolder dan perbedaan besar/kecil huruf.
- Undo **satu batch terakhir**, juga setelah restart aplikasi, jika file dan nama tujuan masih sesuai.
- Tombol **Kosongkan** hanya mengosongkan daftar di UI, tidak menghapus file.
- Mode contoh memakai data simulasi dan tidak mengubah file asli.

## Batasan dan pemulihan

Hanya file biasa di tingkat pertama folder yang diproses. Subfolder, symlink, dan nama internal `.rename-studio-*` dilewati. Tidak ada pemrosesan rekursif. Penomoran semua format berada dalam satu urutan; tidak ada pengelompokan pasangan `.ai`/`.jpg` bernama sama.

Tutup aplikasi yang sedang mengedit file sebelum rename. Preview dan apply memeriksa identitas, ukuran, serta waktu modifikasi file; undo ditolak jika metadata tersebut berubah atau nama awal telah dipakai file lain. Undo bukan backup isi file. Setelah batch baru yang benar-benar mengubah nama berhasil, undo batch sebelumnya digantikan.

Rename menggunakan nama sementara unik sebelum nama akhir sehingga pertukaran nama tidak menimpa file. Jurnal tersimpan **hanya lokal** di `.runtime/`, tidak masuk Git atau paket distribusi. Jika aplikasi berhenti di tengah proses, jalankan kembali **checkout yang sama** untuk memulihkan transaksi yang belum selesai. Jangan menghapus `.runtime/` selama ada transaksi atau undo yang masih diperlukan. Jika file diubah/dihapus aplikasi lain selama rename dan pemulihan otomatis terhalang, aplikasi mempertahankan jurnal dan memberitahukan bahwa perlu pemeriksaan manual. Jangan mengedit jurnal sembarangan.

Server hanya mendengarkan `127.0.0.1` dan memakai token sesi, pemeriksaan Host/Origin, serta daftar aset yang dibatasi. Server tidak dirancang untuk dibuka ke LAN/internet. Jangan menjalankannya dengan proxy publik.

## Pengembangan dan pergantian AI

Folder kerja bersama: `E:\AI-Workspace\Projects\Rename-Studio`.

1. Baca `AGENTS.md`, `PROJECT.md`, dan `STATE.md` di checkout ini.
2. Kerjakan dari folder proyek dan jalankan pengujian.
3. Perbarui `STATE.md` dengan perubahan, bukti pengujian, dan pekerjaan tersisa sebelum berganti agent.
4. Buka folder yang sama melalui Codex, Antigravity, atau Hermes. Untuk Antigravity, baca juga `GEMINI.md`.

Pergantian AI manual mengikuti workflow pengguna. Hermes memakai konfigurasi 9Router milik pengguna; aplikasi rename sendiri tidak memanggil AI atau membutuhkan 9Router. Token/kredensial tidak boleh ditaruh dalam source atau catatan konteks.

```powershell
python -m unittest discover -s tests -v
node --check web/app.js
```

Pengujian membuat file buatan di folder sementara, lalu memverifikasi rename, undo, pemulihan, serta HTTP API. Tidak memakai aset pribadi.
