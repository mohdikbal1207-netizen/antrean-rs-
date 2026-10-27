"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DataLaporan {
  total: number;
  terlayani: number;
  sisa: number;
  detailLoket: { loket: string; jumlah: string }[];
}

export default function LaporanPage() {
  const [laporan, setLaporan] = useState<DataLaporan | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [pencarian, setPencarian] = useState<string>("");
  const [waktuPembaruan, setWaktuPembaruan] = useState<string>("");
  const [tanggalCetak, setTanggalCetak] = useState<string>("");

  // Fitur Auto Refresh 10s & Mode Visual Chart
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [tampilkanChart, setTampilkanChart] = useState<boolean>(true);

  // Fitur Baru: Mode Tampilan Ringkas/Detail & Notifikasi Copypaste Text
  const [modeTampilan, setModeTampilan] = useState<"card" | "tabel">("card");
  const [notifSalin, setNotifSalin] = useState<boolean>(false);

  const muatLaporan = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/laporan");
      const json = await res.json();
      if (json.success) {
        setLaporan(json.data);
        setWaktuPembaruan(
          new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      }
    } catch (err) {
      console.error("Gagal mengambil data laporan:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    muatLaporan();
    // Set tanggal cetak di client side setelah component mount untuk cegah error prerender Turbopack
    setTanggalCetak(new Date().toLocaleDateString("id-ID", { dateStyle: "full" }));
  }, []);

  // Interval Auto-Refresh Pembaruan Laporan 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(muatLaporan, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Hitung Persentase Penyelesaian Pelayanan
  const persentaseSelesai =
    laporan && laporan.total > 0
      ? Math.round((laporan.terlayani / laporan.total) * 100)
      : 0;

  // Indikator Beban Kerja / Jam Sibuk
  const getStatusBeban = () => {
    if (!laporan) return { label: "Normal", warna: "bg-emerald-950 text-emerald-300 border-emerald-700/50" };
    if (laporan.sisa > 20) return { label: "Beban Tinggi / Sibuk", warna: "bg-rose-950 text-rose-300 border-rose-700/50 animate-pulse" };
    if (laporan.sisa > 8) return { label: "Beban Sedang", warna: "bg-amber-950 text-amber-300 border-amber-700/50" };
    return { label: "Normal / Lancar", warna: "bg-emerald-950 text-emerald-300 border-emerald-700/50" };
  };

  const statusBeban = getStatusBeban();

  // Pemetaan Nama Unit RSUD Bukit Kerman Berdasarkan Nomor Loket
  const getNamaLoket = (loketId: string) => {
    switch (loketId) {
      case "1":
        return "Pendaftaran & Loket Informasi";
      case "2":
        return "Kasir & Pembayaran";
      case "3":
        return "Farmasi & Penyerahan Obat";
      default:
        return `Loket Pelayanan ${loketId}`;
    }
  };

  // Ekspor Data Laporan ke CSV
  const eksporCSV = () => {
    if (!laporan) return;
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Metrik Laporan,Jumlah Pasien\n";
    csvContent += `Total Antrean Hari Ini,${laporan.total}\n`;
    csvContent += `Terlayani / Dipanggil,${laporan.terlayani}\n`;
    csvContent += `Belum Dipanggil (Menunggu),${laporan.sisa}\n`;
    csvContent += `Tingkat Pelayanan,${persentaseSelesai}%\n\n`;
    csvContent += "Loket / Unit,Jumlah Pasien\n";

    laporan.detailLoket.forEach((item) => {
      csvContent += `"Loket ${item.loket} - ${getNamaLoket(item.loket)}","${item.jumlah}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `laporan_antrean_rsud_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Ekspor Data Laporan Mentah Format JSON
  const eksporJSON = () => {
    if (!laporan) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(laporan, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `laporan_antrean_rsud_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Salin Ringkasan Teks Laporan ke Clipboard (Untuk WA / Telegram Pemimpin)
  const salinRingkasanTeks = () => {
    if (!laporan) return;
    let teks = `*LAPORAN ANTREAN RSUD BUKIT KERMAN*\n`;
    teks += `Tanggal: ${tanggalCetak}\n`;
    teks += `Waktu Update: ${waktuPembaruan}\n\n`;
    teks += `• Total Pendaftaran: ${laporan.total} Pasien\n`;
    teks += `• Terlayani: ${laporan.terlayani} Pasien (${persentaseSelesai}%)\n`;
    teks += `• Menunggu: ${laporan.sisa} Pasien\n\n`;
    teks += `*RINCIAN LOKET:*\n`;
    laporan.detailLoket.forEach((item) => {
      teks += `- Loket ${item.loket} (${getNamaLoket(item.loket)}): ${item.jumlah} Pasien\n`;
    });
    
    navigator.clipboard.writeText(teks);
    setNotifSalin(true);
    setTimeout(() => setNotifSalin(false), 3000);
  };

  // Filter Loket berdasarkan kata kunci pencarian
  const detailLoketFiltered = laporan?.detailLoket.filter((item) =>
    item.loket.toLowerCase().includes(pencarian.toLowerCase()) ||
    getNamaLoket(item.loket).toLowerCase().includes(pencarian.toLowerCase()) ||
    item.jumlah.toString().includes(pencarian)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-8 font-sans select-none relative">
      
      {/* Toast Notifikasi Berhasil Salin Ringkasan Teks */}
      {notifSalin && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 border border-emerald-400 text-white font-bold px-5 py-3 rounded-2xl shadow-2xl flex items-center space-x-2 animate-bounce">
          <span>📋</span>
          <span className="text-xs">Ringkasan Laporan Berhasil Disalin ke Clipboard!</span>
        </div>
      )}

      {/* Header Bar Navigation & Actions (Disembunyikan saat Print) */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 print:hidden border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-4">
          <Link
            href="/admin"
            className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold px-4 py-2.5 rounded-xl text-sm transition flex items-center gap-2 shadow"
          >
            <span>←</span> Kembali ke Control Panel
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-wide">
              Laporan & Statistik Antrean Harian
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              RSUD Bukit Kerman — Pemantauan Real-Time Kinerja Loket Pelayanan
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {waktuPembaruan && (
            <span className="text-xs font-mono text-slate-400 hidden xl:inline-block">
              Diperbarui: <strong className="text-yellow-400">{waktuPembaruan}</strong>
            </span>
          )}

          {/* Toggle Auto Sync 10s */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            title="Toggle Pembaruan Otomatis 10s"
            className={`px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
              autoRefresh ? "bg-emerald-950/50 border-emerald-700/50 text-emerald-300" : "bg-slate-800 border-slate-700 text-slate-400"
            }`}
          >
            {autoRefresh ? "🔄 Sync 10s" : "⏸️ Paused"}
          </button>

          {/* Toggle Mode Tampilan (Card / Tabel) */}
          <button
            onClick={() => setModeTampilan(modeTampilan === "card" ? "tabel" : "card")}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer"
            title="Ganti Mode Tampilan Tipe Card atau Tabel"
          >
            {modeTampilan === "card" ? "📋 Tampilan Tabel" : "🎴 Tampilan Cards"}
          </button>

          {/* Toggle Visual Chart */}
          <button
            onClick={() => setTampilkanChart(!tampilkanChart)}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer"
          >
            {tampilkanChart ? "📊 Sembunyikan Chart" : "📊 Tampilkan Chart"}
          </button>

          <button
            onClick={muatLaporan}
            disabled={loading}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold px-3.5 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <span>{loading ? "🔄 Memuat..." : "🔄 Refresh"}</span>
          </button>

          <button
            onClick={salinRingkasanTeks}
            disabled={!laporan}
            className="bg-indigo-950/60 hover:bg-indigo-700 border border-indigo-700/50 text-indigo-300 hover:text-white text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50"
            title="Salin Teks Ringkasan untuk Pesan Broadcast"
          >
            <span>💬 Salin Teks</span>
          </button>

          <button
            onClick={eksporCSV}
            disabled={!laporan}
            className="bg-emerald-950/60 hover:bg-emerald-700 border border-emerald-700/50 text-emerald-300 hover:text-white text-xs font-bold px-3.5 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow"
          >
            <span>📥 Ekspor CSV</span>
          </button>

          <button
            onClick={eksporJSON}
            disabled={!laporan}
            className="bg-purple-950/60 hover:bg-purple-700 border border-purple-700/50 text-purple-300 hover:text-white text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50"
            title="Ekspor JSON"
          >
            <span>JSON</span>
          </button>

          <button
            onClick={() => window.print()}
            disabled={!laporan}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold px-4 py-2.5 rounded-xl transition cursor-pointer shadow-lg shadow-blue-900/30 flex items-center gap-1.5"
          >
            <span>🖨️ Cetak Laporan</span>
          </button>
        </div>
      </header>

      {/* Header Khusus Tampilan Cetak (Print Only Document Header) */}
      <div className="hidden print:block mb-6 border-b-2 border-slate-900 pb-4 text-black">
        <h1 className="text-2xl font-black uppercase tracking-wide">RSUD BUKIT KERMAN KABUPATEN KERINCI</h1>
        <h2 className="text-lg font-bold text-slate-700">Laporan Eksekutif Ringkasan Kinerja Antrean Harian</h2>
        <div className="flex justify-between text-xs text-slate-600 mt-2">
          <p>Tanggal Cetak Dokumen: <strong>{tanggalCetak || "-"}</strong></p>
          <p>Waktu Pembaruan Data: <strong>{waktuPembaruan || "-"}</strong></p>
        </div>
      </div>

      {laporan ? (
        <div className="space-y-6">
          
          {/* Status Bar Indikator Jam Sibuk & Target Pelayanan SLA */}
          <div className="flex flex-wrap items-center justify-between bg-slate-900/90 border border-slate-800 p-4 rounded-2xl gap-3">
            <div className="flex items-center space-x-3">
              <span className="text-xs font-bold uppercase text-slate-400">Status Operasional Antrean:</span>
              <span className={`text-xs font-extrabold px-3 py-1 rounded-full border ${statusBeban.warna}`}>
                {statusBeban.label}
              </span>
            </div>
            
            {/* Indikator SLA Target RSUD */}
            <div className="flex items-center space-x-4 text-xs font-mono">
              <span className="text-slate-400">
                Target SLA (≥85%):{" "}
                <strong className={persentaseSelesai >= 85 ? "text-emerald-400" : "text-amber-400"}>
                  {persentaseSelesai >= 85 ? "✅ Terpenuhi" : "⚠️ Perlu Ditinjau"}
                </strong>
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-slate-400">
                Estimasi Rata-rata Waktu Layanan: <strong className="text-yellow-400">~3-5 Menit / Pasien</strong>
              </span>
            </div>
          </div>

          {/* Grid Cards Statistik Utama 4 Kolom */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-blue-900/30 border border-blue-700/50 p-6 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-xl pointer-events-none"></div>
              <p className="text-xs text-blue-300 uppercase font-extrabold tracking-wider">Total Antrean Hari Ini</p>
              <p className="text-5xl font-black text-white mt-3 tracking-tight">{laporan.total}</p>
              <p className="text-[11px] text-slate-400 mt-2">Seluruh pasien yang mendaftar</p>
            </div>

            <div className="bg-emerald-900/30 border border-emerald-700/50 p-6 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl pointer-events-none"></div>
              <p className="text-xs text-emerald-300 uppercase font-extrabold tracking-wider">Terlayani / Dipanggil</p>
              <p className="text-5xl font-black text-emerald-400 mt-3 tracking-tight">{laporan.terlayani}</p>
              <p className="text-[11px] text-slate-400 mt-2">Pasien selesai & dalam pelayanan</p>
            </div>

            <div className="bg-amber-900/30 border border-amber-700/50 p-6 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none"></div>
              <p className="text-xs text-amber-300 uppercase font-extrabold tracking-wider">Belum Dipanggil (Menunggu)</p>
              <p className="text-5xl font-black text-amber-400 mt-3 tracking-tight">{laporan.sisa}</p>
              <p className="text-[11px] text-slate-400 mt-2">Masih dalam antrean tunggu</p>
            </div>

            <div className="bg-purple-900/30 border border-purple-700/50 p-6 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-xl pointer-events-none"></div>
              <p className="text-xs text-purple-300 uppercase font-extrabold tracking-wider">Tingkat Pelayanan</p>
              <p className="text-5xl font-black text-purple-300 mt-3 tracking-tight">{persentaseSelesai}%</p>
              <p className="text-[11px] text-slate-400 mt-2">Rasio penyelesaian pelayanan</p>
            </div>
          </div>

          {/* Card Progress Bar Tingkat Pelayanan */}
          <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-2xl shadow-xl">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Progress Pelayanan Harian
              </span>
              <span className="text-xs font-extrabold text-emerald-400">
                {laporan.terlayani} dari {laporan.total} Pasien Terlayani ({persentaseSelesai}%)
              </span>
            </div>
            <div className="w-full bg-slate-950 h-3.5 rounded-full overflow-hidden p-0.5 border border-slate-800">
              <div
                className="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${persentaseSelesai}%` }}
              ></div>
            </div>
          </div>

          {/* Visual Bar Chart Perbandingan Beban Loket (Native Tailwind) */}
          {tampilkanChart && (
            <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-3xl shadow-xl print:hidden">
              <h3 className="text-sm font-extrabold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span>📈</span> Perbandingan Beban Pelayanan Per Loket
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {laporan.detailLoket.map((item, idx) => {
                  const jumlahPasien = parseInt(item.jumlah) || 0;
                  const maxJumlah = Math.max(...laporan.detailLoket.map((d) => parseInt(d.jumlah) || 1));
                  const tinggiPersen = Math.round((jumlahPasien / maxJumlah) * 100);

                  return (
                    <div key={idx} className="bg-slate-950 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between space-y-3">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-xs font-bold text-slate-300 block">Loket {item.loket}</span>
                          <span className="text-[10px] text-slate-500">{getNamaLoket(item.loket)}</span>
                        </div>
                        <span className="text-sm font-black text-yellow-400">{item.jumlah} Pasien</span>
                      </div>
                      <div className="w-full bg-slate-900 h-24 rounded-xl flex items-end p-2 border border-slate-800">
                        <div
                          className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-lg transition-all duration-500"
                          style={{ height: `${Math.max(tinggiPersen, 8)}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Card Detail Rincian Per Loket (Mode Cards vs Tabel) */}
          <div className="bg-slate-900/80 border border-slate-800 p-6 sm:p-8 rounded-3xl shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 print:mb-4">
              <div>
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                  <span>📊</span> Rincian Beban Kerja Per Loket
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Jumlah distribusi pelayanan antrean berdasarkan masing-masing unit loket RSUD Bukit Kerman
                </p>
              </div>

              {/* Input Filter Loket (Disembunyikan saat Print) */}
              <div className="print:hidden">
                <input
                  type="text"
                  placeholder="Cari loket/unit..."
                  value={pencarian}
                  onChange={(e) => setPencarian(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-full sm:w-56"
                />
              </div>
            </div>

            {/* Render Mode Card */}
            {modeTampilan === "card" ? (
              <div className="space-y-3">
                {detailLoketFiltered && detailLoketFiltered.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs">
                    Tidak ada data loket yang sesuai dengan pencarian.
                  </div>
                ) : (
                  detailLoketFiltered?.map((item, idx) => {
                    const jumlahPasien = parseInt(item.jumlah) || 0;
                    const kontribusi =
                      laporan.total > 0
                        ? Math.round((jumlahPasien / laporan.total) * 100)
                        : 0;

                    return (
                      <div
                        key={idx}
                        className="bg-slate-950 border border-slate-800 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="bg-blue-900/40 border border-blue-700/50 text-blue-300 font-black text-sm w-10 h-10 rounded-xl flex items-center justify-center">
                            L{item.loket}
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <p className="font-bold text-slate-200 text-sm">Loket {item.loket}</p>
                              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
                                {getNamaLoket(item.loket)}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Beban Pelayanan: <span className="text-slate-300 font-semibold">{kontribusi}%</span> dari total hari ini
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-4">
                          {/* Visual Bar Mini per Loket */}
                          <div className="w-32 bg-slate-900 h-2 rounded-full hidden md:block overflow-hidden border border-slate-800">
                            <div
                              className="bg-yellow-500 h-full rounded-full"
                              style={{ width: `${kontribusi}%` }}
                            ></div>
                          </div>
                          <span className="text-xl font-black text-yellow-400 min-w-[100px] text-right">
                            {item.jumlah} Pasien
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* Render Mode Tabel Formal */
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase font-bold border-b border-slate-800">
                    <tr>
                      <th className="p-3">Loket</th>
                      <th className="p-3">Nama Unit Pelayanan</th>
                      <th className="p-3 text-center">Beban Pelayanan</th>
                      <th className="p-3 text-right">Jumlah Pasien</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {detailLoketFiltered?.map((item, idx) => {
                      const jumlahPasien = parseInt(item.jumlah) || 0;
                      const kontribusi =
                        laporan.total > 0
                          ? Math.round((jumlahPasien / laporan.total) * 100)
                          : 0;
                      return (
                        <tr key={idx} className="hover:bg-slate-950/50 transition">
                          <td className="p-3 font-bold text-blue-400">Loket {item.loket}</td>
                          <td className="p-3 text-white font-medium">{getNamaLoket(item.loket)}</td>
                          <td className="p-3 text-center">{kontribusi}%</td>
                          <td className="p-3 text-right font-black text-yellow-400 text-sm">{item.jumlah} Pasien</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Blok Lembar Tanda Tangan Cetak Dokumen Formal (Print Only) */}
          <div className="hidden print:grid grid-cols-2 gap-8 pt-12 text-black text-center text-xs">
            <div>
              <p>Mengetahui,</p>
              <p className="font-bold mt-1">Kepala RSUD Bukit Kerman</p>
              <div className="h-20"></div>
              <p className="font-bold underline">dr. H. Syafrial</p>
              <p className="text-[10px] text-slate-600">NIP. 19750812 200501 1 004</p>
            </div>
            <div>
              <p>Kabupaten Kerinci, {tanggalCetak || "...................."}</p>
              <p className="font-bold mt-1">Penanggung Jawab Unit Pelayanan</p>
              <div className="h-20"></div>
              <p className="font-bold underline">( .................................................... )</p>
              <p className="text-[10px] text-slate-600">NIP. ...............................................</p>
            </div>
          </div>

        </div>
      ) : (
        /* Empty / Loading Skeleton State */
        <div className="bg-slate-900/60 border border-slate-800 p-12 rounded-3xl text-center space-y-4">
          <div className="inline-block animate-spin text-3xl mb-2">⏳</div>
          <p className="text-slate-300 font-semibold text-base">Memuat data statistik antrean...</p>
          <p className="text-xs text-slate-500">Mengambil informasi laporan terbaru dari server RSUD Bukit Kerman</p>
        </div>
      )}
    </div>
  );
}