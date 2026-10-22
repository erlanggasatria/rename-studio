# Rename Studio

## Tujuan
Web lokal Windows untuk mengganti nama file dalam satu folder menjadi nama custom dan nomor berurutan. Contoh 10 file EV_SB01–EV_SB10; 100 file NamaCUSTOM001–NamaCUSTOM100. Ekstensi dan isi file harus tetap.

## Keputusan
- Pengguna memilih rename langsung di folder asal, tanpa upload atau menyalin isi file.
- Python 3 standard library untuk server dan operasi filesystem; HTML/CSS/JavaScript tanpa dependency build untuk UI.
- Folder level pertama saja; symlink dan subfolder tidak diproses. Semua ekstensi didukung.
- Nomor minimal dua digit secara otomatis, diperbesar sesuai nomor terakhir. Awal nomor dan minimum digit dapat diatur.
- Preview server menjadi dasar apply; deteksi bentrok, fingerprint file, transaksi dua tahap, jurnal pemulihan, dan undo batch terakhir.
- Buat repository GitHub baru bernama rename-studio jika tersedia; gunakan private sebagai default.
- Versi awal lokal tetap tersedia. Pada 22 Oktober 2026 pengguna meminta deployment Cloudflare dan memilih mode web pembuat skrip Windows, tanpa upload atau salin isi file.
- Cloudflare menerbitkan aset statis dari dist; browser memproses metadata dan membuat .cmd. Skrip PowerShell di Windows menerapkan rename serta undo di folder yang dipilih pengguna. Tidak ada kebutuhan server Python pada deployment.
- Target Worker Cloudflare: rename-studio. Build command dashboard: npm run build, deploy command: npx wrangler deploy, root: /.

## Workflow AI
Satu checkout ini digunakan bergantian melalui Codex, Antigravity, dan Hermes. Baca konteks dari file, bukan salinan chat. Codex/Antigravity memakai login resmi; Hermes melalui 9Router yang sudah disetel pengguna. Pergantian agent manual; tidak mengubah provider atau mengaktifkan fallback otomatis.

## Selesai jika
UI responsif, rename asli dan undo lolos pengujian folder sementara, dokumentasi serta launcher tersedia, dan source dipush ke repository (atau hambatan akses Git dicatat dengan jelas).
