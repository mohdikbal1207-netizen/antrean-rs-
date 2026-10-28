"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AntreanItem {
  id: number;
  nomor_antrean: string;
  waktu_panggil: string;
}

interface LogAksiItem {
  id: string;
  waktu: string;
  pesan: string;
  tipe: "panggil" | "skip" | "selesai" | "transfer" | "reset";
}

// ==========================================
// FUNGSI PENJELAS SUARA TTS (TERBILANG INDONESIA)
// ==========================================

// 1. Konversi angka menjadi sebutan terbilang alami (contoh: 0 -> nol, 11 -> sebelas, 25 -> dua puluh lima)
function terbilang(n: number): string {
  if (n === 0) return "nol";

  const satuan = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];

  let hasil = "";

  if (n < 12) {
    hasil = satuan[n];
  } else if (n < 20) {
    hasil = terbilang(n - 10) + " belas";
  } else if (n < 100) {
    hasil = terbilang(Math.floor(n / 10)) + " puluh " + terbilang(n % 10);
  } else if (n < 200) {
    hasil = "seratus " + terbilang(n % 100);
  } else if (n < 1000) {
    hasil = terbilang(Math.floor(n / 100)) + " ratus " + terbilang(n % 100);
  } else {
    hasil = n.toString();
  }

  return hasil.replace(/\s+/g, " ").trim();
}

// 2. Format nomor antrean agar dibaca jelas oleh TTS (contoh: "A-011" -> "A, sebelas")
function formatNomorAntreanTTS(nomorAntrean: string): string {
  if (!nomorAntrean) return "";

  const cleanNomor = nomorAntrean.trim().toUpperCase();
  const match = cleanNomor.match(/^([A-Z]+)[-]?(\d+)$/);

  if (match) {
    const kodeHuruf = match[1];
    const angkaInt = parseInt(match[2], 10); // Menghilangkan 0 di depan (011 -> 11)
    const sebutanAngka = terbilang(angkaInt);

    return `${kodeHuruf}, ${sebutanAngka}`;
  }

  return cleanNomor.split("").join(" ");
}

// ==========================================
// KOMPONEN UTAMA HALAMAN ADMIN
// ==========================================

export default function AdminPage() {
  const [nomor, setNomor] = useState("");
  const [loket, setLoket] = useState("1");
  const [terakhirDipanggil, setTerakhirDipanggil] = useState<string | null>(null);
  const [daftarMenunggu, setDaftarMenunggu] = useState<AntreanItem[]>([]);
  const [daftarDilewati, setDaftarDilewati] = useState<AntreanItem[]>([]);
  const [tabAktif, setTabAktif] = useState<"menunggu" | "dilewati">("menunggu");
  const [loading, setLoading] = useState(false);
  const [pencarian, setPencarian] = useState("");

  // State Notifikasi Toast, Jam Real-Time, & Filter Kategori
  const [notifikasi, setNotifikasi] = useState<string | null>(null);
  const [waktu, setWaktu] = useState<string>("");
  const [hanyaKategoriIni, setHanyaKategoriIni] = useState(false);

  // UI/UX: Counter Pelayanan, Toggle Suara, Status Server & Modal Shortcut
  const [totalSelesai, setTotalSelesai] = useState<number>(0);
  const [suaraAktif, setSuaraAktif] = useState<boolean>(true);
  const [jumlahRecall, setJumlahRecall] = useState<number>(1);
  const [showShortcutModal, setShowShortcutModal] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // Durasi Pelayanan Pasien & Control Polling
  const [durasiPelayanan, setDurasiPelayanan] = useState<number>(0);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  // TTS Voice Caller, Session Activity Log, Fullscreen & Log Modal
  const [suaraTTS, setSuaraTTS] = useState<boolean>(true);
  const [riwayatLog, setRiwayatLog] = useState<LogAksiItem[]>([]);
  const [showLogModal, setShowLogModal] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Fungsi Pembantu Pencatat Log Aktivitas Sesi Ini
  const tambahLog = (pesan: string, tipe: LogAksiItem["tipe"]) => {
    const logBaru: LogAksiItem = {
      id: Math.random().toString(36).substring(2, 9),
      waktu: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      pesan,
      tipe,
    };
    setRiwayatLog((prev) => [logBaru, ...prev.slice(0, 49)]); // Simpan 50 log terakhir
  };

  // Efek Suara Voice Text-To-Speech Bahasa Indonesia (Sudah Ditingkatkan Artikulasinya)
  const ulasSuaraTTS = (nomorAntrean: string, targetLoket: string) => {
    if (!suaraTTS || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel(); // Hentikan antrean suara sebelumnya

      const sebutanJelas = formatNomorAntreanTTS(nomorAntrean);
      const teksPengumuman = `Nomor antrean ${sebutanJelas}, silakan menuju ke loket ${targetLoket}`;
      
      const utterance = new SpeechSynthesisUtterance(teksPengumuman);
      utterance.lang = "id-ID";
      utterance.rate = 0.85; // Kecepatan disesuaikan agar artikulasi suara alami & jelas
      utterance.pitch = 1.0;

      // Utamakan penggunaan vokal Bahasa Indonesia jika tersedia di browser
      const voices = window.speechSynthesis.getVoices();
      const indonesianVoice = voices.find((v) => v.lang.includes("id") || v.lang.includes("ID"));
      if (indonesianVoice) {
        utterance.voice = indonesianVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("Gagal memutar TTS:", e);
    }
  };

  // Efek Suara Chime Panggilan (Web Audio API Synthesizer)
  const bunyikanChime = () => {
    if (!suaraAktif) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
      // Audio fallback silent ignore
    }
  };

  // Fungsi pembantu pesan Toast Notifikasi & Trigger Suara
  const tampilkanToast = (pesan: string, nomorAntreanTts?: string) => {
    setNotifikasi(pesan);
    bunyikanChime();
    if (nomorAntreanTts) {
      setTimeout(() => ulasSuaraTTS(nomorAntreanTts, loket), 300);
    }
    setTimeout(() => {
      setNotifikasi(null);
    }, 3200);
  };

  // Toggle Mode Fullscreen Browser
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      }
    }
  };

  // Ekspor Ringkasan Log Sesi ke CSV
  const eksporLogCSV = () => {
    if (riwayatLog.length === 0) {
      alert("Belum ada riwayat aktivitas pada sesi ini.");
      return;
    }
    let csvContent = "data:text/csv;charset=utf-8,Waktu,Tipe,Pesan\n";
    riwayatLog.forEach((row) => {
      csvContent += `"${row.waktu}","${row.tipe.toUpperCase()}","${row.pesan.replace(/"/g, '""')}"\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `log_antrean_loket_${loket}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Timer Durasi Pelayanan Pasien yang Sedang Dipanggil
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (terakhirDipanggil) {
      timer = setInterval(() => {
        setDurasiPelayanan((prev) => prev + 1);
      }, 1000);
    } else {
      setDurasiPelayanan(0);
    }
    return () => clearInterval(timer);
  }, [terakhirDipanggil]);

  const formatDurasi = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Update Jam Digital Real-time & Status Koneksi
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setWaktu(
        now.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }, 1000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      clearInterval(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Pemetaan Kategori berdasarkan Loket RSUD Bukit Kerman
  const getKategoriLoket = (loketId: string) => {
    switch (loketId) {
      case "1":
        return { kode: "A", nama: "Pendaftaran", warna: "border-blue-500/40 bg-blue-500/10 text-blue-400" };
      case "2":
        return { kode: "B", nama: "Kasir", warna: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" };
      case "3":
        return { kode: "C", nama: "Farmasi", warna: "border-amber-500/40 bg-amber-500/10 text-amber-400" };
      default:
        return { kode: "A", nama: "Pendaftaran", warna: "border-blue-500/40 bg-blue-500/10 text-blue-400" };
    }
  };

  const kategoriAktif = getKategoriLoket(loket);

  // Pewarna Badge Kode Antrean
  const getBadgeWarna = (nomorAntrean: string) => {
    if (nomorAntrean.startsWith("A")) return "bg-blue-900/40 text-blue-300 border-blue-700/40";
    if (nomorAntrean.startsWith("B")) return "bg-emerald-900/40 text-emerald-300 border-emerald-700/40";
    if (nomorAntrean.startsWith("C")) return "bg-amber-900/40 text-amber-300 border-amber-700/40";
    if (nomorAntrean.startsWith("P")) return "bg-rose-900/40 text-rose-300 border-rose-700/40";
    return "bg-slate-800 text-slate-300 border-slate-700";
  };

  // Format Pembantu Tampilan Jam & Tanggal Tiket
  const formatWaktuTiket = (isoString?: string) => {
    if (!isoString) return { jam: "Pilih nomor", tanggal: "" };
    try {
      const d = new Date(isoString);
      const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB";
      const tanggal = d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
      return { jam, tanggal };
    } catch {
      return { jam: "Pilih nomor", tanggal: "" };
    }
  };

  const ambilAntreanMenunggu = async () => {
    try {
      const res = await fetch("/api/antrean-menunggu");
      const json = await res.json();
      if (json.success) setDaftarMenunggu(json.data);
    } catch (err) {
      console.error("Gagal memuat antrean menunggu:", err);
    }
  };

  const ambilAntreanDilewati = async () => {
    try {
      const res = await fetch("/api/antrean-dilewati");
      const json = await res.json();
      if (json.success) setDaftarDilewati(json.data);
    } catch (err) {
      console.error("Gagal memuat antrean dilewati:", err);
    }
  };

  const muatSemuaData = () => {
    ambilAntreanMenunggu();
    ambilAntreanDilewati();
  };

  useEffect(() => {
    const ambilTerakhirDipanggil = async () => {
      try {
        const res = await fetch("/api/riwayat");
        const json = await res.json();
        if (json.success && json.data.length > 0) {
          const antreanLoketIni = json.data.find(
            (item: { loket: string }) => item.loket === loket
          );
          if (antreanLoketIni && antreanLoketIni.nomor !== terakhirDipanggil) {
            setTerakhirDipanggil(antreanLoketIni.nomor);
            setJumlahRecall(1);
          }
        }
      } catch (err) {
        console.error("Gagal memuat riwayat admin:", err);
      }
    };

    ambilTerakhirDipanggil();
    muatSemuaData();

    if (!autoRefresh) return;
    const interval = setInterval(muatSemuaData, 5000);
    return () => clearInterval(interval);
  }, [loket, autoRefresh]);

  const kirimPanggilan = async (nomorAntrean: string) => {
    if (!nomorAntrean) return;

    setLoading(true);
    try {
      const res = await fetch("/api/panggil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomor: nomorAntrean, loket }),
      });

      const data = await res.json();
      if (data.success) {
        if (terakhirDipanggil === nomorAntrean) {
          setJumlahRecall((prev) => prev + 1);
          const msg = `Recall (${jumlahRecall + 1}x): Memanggil ${nomorAntrean} ke Loket ${loket}`;
          tampilkanToast(msg, nomorAntrean);
          tambahLog(msg, "panggil");
        } else {
          setTerakhirDipanggil(nomorAntrean);
          setJumlahRecall(1);
          const msg = `Memanggil ${nomorAntrean} ke Loket ${loket}`;
          tampilkanToast(msg, nomorAntrean);
          tambahLog(msg, "panggil");
        }
        setNomor("");
        muatSemuaData();
      } else {
        alert("Gagal memanggil: " + data.message);
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi");
    } finally {
      setLoading(false);
    }
  };

  const panggilSelanjutnya = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/panggil-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loket }),
      });

      const data = await res.json();
      if (data.success) {
        setTerakhirDipanggil(data.nomor_antrean);
        setJumlahRecall(1);
        setNomor("");
        muatSemuaData();
        const msg = `Auto-Next: Memanggil ${data.nomor_antrean}`;
        tampilkanToast(msg, data.nomor_antrean);
        tambahLog(msg, "panggil");
      } else {
        alert(data.message || `Tidak ada antrean menunggu untuk Kategori ${kategoriAktif.kode}.`);
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi");
    } finally {
      setLoading(false);
    }
  };

  const lewatiAntrean = async (targetNomor: string) => {
    if (!targetNomor) return;

    setLoading(true);
    try {
      const res = await fetch("/api/panggil-skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomor: targetNomor }),
      });

      const data = await res.json();
      if (data.success) {
        if (terakhirDipanggil === targetNomor) {
          setTerakhirDipanggil(null);
        }
        setNomor("");
        muatSemuaData();
        const msg = `Antrean ${targetNomor} dilewati (SKIP)`;
        tampilkanToast(msg);
        tambahLog(msg, "skip");
      } else {
        alert("Gagal melewatinya: " + data.message);
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi");
    } finally {
      setLoading(false);
    }
  };

  const selesaikanPelayanan = () => {
    if (!terakhirDipanggil) return;
    setTotalSelesai((prev) => prev + 1);
    const msg = `Pelayanan antrean ${terakhirDipanggil} selesai (Durasi: ${formatDurasi(durasiPelayanan)}) ✅`;
    tampilkanToast(msg);
    tambahLog(msg, "selesai");
    setTerakhirDipanggil(null);
    setJumlahRecall(1);
  };

  const transferAntrean = async (tujuanKategori: string) => {
    if (!terakhirDipanggil) return;
    setLoading(true);
    try {
      const res = await fetch("/api/cetak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kategori: tujuanKategori }),
      });
      const data = await res.json();
      if (data.success) {
        const msg = `Antrean ${terakhirDipanggil} ditransfer ke Kategori ${tujuanKategori} (${data.nomor_antrean}) ↪️`;
        tampilkanToast(msg);
        tambahLog(msg, "transfer");
        setTerakhirDipanggil(null);
        setJumlahRecall(1);
        muatSemuaData();
      }
    } catch (err) {
      alert("Gagal mentransfer antrean");
    } finally {
      setLoading(false);
    }
  };

  const resetHarian = async () => {
    if (!confirm("Apakah Anda yakin ingin mereset seluruh data antrean hari ini?")) return;

    try {
      const res = await fetch("/api/reset-antrean", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        setTerakhirDipanggil(null);
        setTotalSelesai(0);
        setJumlahRecall(1);
        setNomor("");
        muatSemuaData();
        const msg = "Seluruh data antrean hari ini telah direset 🔄";
        tampilkanToast(msg);
        tambahLog(msg, "reset");
      } else {
        alert("Gagal mereset: " + data.message);
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi");
    }
  };

  const panggilBaru = (e: React.FormEvent) => {
    e.preventDefault();
    kirimPanggilan(nomor);
  };

  // Pintas Keyboard Lengkap (Alt+N, Alt+R, Alt+S, Alt+D, Alt+K, Alt+M)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        panggilSelanjutnya();
      } else if (e.altKey && e.key.toLowerCase() === "r" && terakhirDipanggil) {
        e.preventDefault();
        kirimPanggilan(terakhirDipanggil);
      } else if (e.altKey && e.key.toLowerCase() === "s" && terakhirDipanggil) {
        e.preventDefault();
        lewatiAntrean(terakhirDipanggil);
      } else if (e.altKey && e.key.toLowerCase() === "d" && terakhirDipanggil) {
        e.preventDefault();
        selesaikanPelayanan();
      } else if (e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowShortcutModal((prev) => !prev);
      } else if (e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setSuaraAktif((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [terakhirDipanggil, loket, jumlahRecall]);

  // Filter antrean berdasarkan pencarian & kategori aktif
  const filterKategoriFn = (item: AntreanItem) => {
    if (hanyaKategoriIni) {
      return item.nomor_antrean.startsWith(kategoriAktif.kode);
    }
    return true;
  };

  const daftarMenungguFiltered = daftarMenunggu
    .filter(filterKategoriFn)
    .filter((item) => item.nomor_antrean.toLowerCase().includes(pencarian.toLowerCase()));

  const daftarDilewatiFiltered = daftarDilewati
    .filter(filterKategoriFn)
    .filter((item) => item.nomor_antrean.toLowerCase().includes(pencarian.toLowerCase()));

  return (
    <div className="min-h-screen w-full bg-slate-950 text-white flex flex-col font-sans select-none relative">
      
      {/* Toast Notification Floating Alert */}
      {notifikasi && (
        <div className="fixed top-20 right-6 z-50 bg-blue-600 border border-blue-400 text-white font-bold px-5 py-3 rounded-2xl shadow-2xl animate-bounce flex items-center space-x-2">
          <span className="text-xl">🔔</span>
          <span className="text-sm tracking-wide">{notifikasi}</span>
        </div>
      )}

      {/* Modal Bantuan Pintasan Keyboard (Alt + K) */}
      {showShortcutModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 p-6 md:p-8 rounded-3xl max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>⌨️</span> Pintasan Keyboard Sistem
              </h3>
              <button
                onClick={() => setShowShortcutModal(false)}
                className="text-slate-400 hover:text-white font-bold text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-300 font-medium">Panggil Selanjutnya (Auto-Next)</span>
                <kbd className="bg-emerald-950 text-emerald-400 border border-emerald-700/50 px-2.5 py-1 rounded font-mono font-bold">Alt + N</kbd>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-300 font-medium">Panggil Ulang (Recall)</span>
                <kbd className="bg-slate-800 text-slate-200 border border-slate-600 px-2.5 py-1 rounded font-mono font-bold">Alt + R</kbd>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-300 font-medium">Lewati Antrean (Skip)</span>
                <kbd className="bg-amber-950 text-amber-400 border border-amber-700/50 px-2.5 py-1 rounded font-mono font-bold">Alt + S</kbd>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-300 font-medium">Tandai Pelayanan Selesai</span>
                <kbd className="bg-blue-950 text-blue-400 border border-blue-700/50 px-2.5 py-1 rounded font-mono font-bold">Alt + D</kbd>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-300 font-medium">Toggle Suara Notifikasi</span>
                <kbd className="bg-purple-950 text-purple-400 border border-purple-700/50 px-2.5 py-1 rounded font-mono font-bold">Alt + M</kbd>
              </div>
            </div>
            <button
              onClick={() => setShowShortcutModal(false)}
              className="w-full bg-blue-600 hover:bg-blue-500 font-bold py-3 rounded-xl transition text-sm cursor-pointer"
            >
              Tutup Panduan
            </button>
          </div>
        </div>
      )}

      {/* Modal Riwayat Aktivitas Sesi (Log Viewer) */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl max-w-2xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span>📜</span> Riwayat Aktivitas Sesi Ini
                </h3>
                <p className="text-xs text-slate-400">Log operasional pemanggil antrean real-time</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={eksporLogCSV}
                  className="bg-emerald-950/60 hover:bg-emerald-700 text-emerald-300 hover:text-white border border-emerald-700/50 text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer"
                >
                  📥 Ekspor CSV
                </button>
                <button
                  onClick={() => setShowLogModal(false)}
                  className="text-slate-400 hover:text-white font-bold text-lg cursor-pointer px-2"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[250px]">
              {riwayatLog.length === 0 ? (
                <div className="text-slate-500 text-xs text-center py-16">Belum ada aktivitas yang tercatat.</div>
              ) : (
                riwayatLog.map((log) => (
                  <div key={log.id} className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-3">
                      <span className="font-mono text-slate-500 text-[11px]">{log.waktu}</span>
                      <span className="text-slate-200 font-medium">{log.pesan}</span>
                    </div>
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                      log.tipe === "panggil" ? "bg-blue-950 border-blue-700 text-blue-300" :
                      log.tipe === "selesai" ? "bg-emerald-950 border-emerald-700 text-emerald-300" :
                      log.tipe === "skip" ? "bg-amber-950 border-amber-700 text-amber-300" :
                      log.tipe === "transfer" ? "bg-purple-950 border-purple-700 text-purple-300" :
                      "bg-rose-950 border-rose-700 text-rose-300"
                    }`}>
                      {log.tipe}
                    </span>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setShowLogModal(false)}
              className="w-full bg-slate-800 hover:bg-slate-700 font-bold py-2.5 rounded-xl transition text-xs cursor-pointer border border-slate-700"
            >
              Tutup Riwayat
            </button>
          </div>
        </div>
      )}

      {/* Header Bar Layar Penuh */}
      <header className="w-full bg-slate-900/90 border-b border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-4 backdrop-blur sticky top-0 z-40">
        <div className="flex items-center space-x-4">
          <div className="bg-gradient-to-tr from-blue-700 to-blue-500 text-white font-black px-3.5 py-2 rounded-xl text-xl tracking-wider shadow-lg shadow-blue-900/30 border border-blue-400/30">
            RSUD
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-extrabold text-white tracking-wide flex items-center gap-2">
              <span>Loket {loket} — {kategoriAktif.nama}</span>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${kategoriAktif.warna}`}>
                Kat. {kategoriAktif.kode}
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Sistem Kontrol Pemanggil Antrean RSUD Bukit Kerman Kabupaten Kerinci
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          {/* Status Live Server & Clock */}
          <div className="hidden lg:flex items-center space-x-3 bg-slate-950 border border-slate-800 px-4 py-2 rounded-xl">
            <div className="flex items-center space-x-1.5">
              <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`}></span>
              <span className="text-[11px] font-bold text-slate-400 uppercase">{isOnline ? "Live Sync" : "Offline"}</span>
            </div>
            <span className="text-slate-700">|</span>
            <p className="text-sm font-mono font-black text-yellow-400 tracking-wider">{waktu || "00:00:00"}</p>
          </div>

          {/* Toggle Auto Sync Polling */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            title="Toggle Pembaruan Otomatis 5s"
            className={`px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
              autoRefresh ? "bg-emerald-950/50 border-emerald-700/50 text-emerald-300" : "bg-slate-800 border-slate-700 text-slate-400"
            }`}
          >
            {autoRefresh ? "🔄 Sync 5s" : "⏸️ Paused"}
          </button>

          {/* Toggle Suara TTS Voice */}
          <button
            onClick={() => setSuaraTTS(!suaraTTS)}
            title="Toggle Suara TTS Pemanggil"
            className={`p-2.5 rounded-xl border text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
              suaraTTS
                ? "bg-indigo-950/50 border-indigo-700/50 text-indigo-300 hover:bg-indigo-900/60"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
            }`}
          >
            <span>{suaraTTS ? "🗣️ Voice ON" : "🗣️ Voice OFF"}</span>
          </button>

          {/* Toggle Suara Chime Mute/Unmute */}
          <button
            onClick={() => setSuaraAktif(!suaraAktif)}
            title="Toggle Suara Chime Panggilan (Alt + M)"
            className={`p-2.5 rounded-xl border text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
              suaraAktif
                ? "bg-purple-950/40 border-purple-700/50 text-purple-300 hover:bg-purple-900/60"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
            }`}
          >
            <span>{suaraAktif ? "🔊 Chime" : "🔇 Mute"}</span>
          </button>

          {/* Tombol Riwayat Log Sesi */}
          <button
            onClick={() => setShowLogModal(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold p-2.5 rounded-xl border border-slate-700 transition flex items-center gap-1 cursor-pointer"
            title="Lihat Log Aktivitas Sesi"
          >
            <span>📜 Log</span>
          </button>

          {/* Tombol Fullscreen Mode */}
          <button
            onClick={toggleFullscreen}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold p-2.5 rounded-xl border border-slate-700 transition flex items-center gap-1 cursor-pointer"
            title="Toggle Fullscreen Screen"
          >
            <span>{isFullscreen ? "↙️ Restore" : "⛶ Full"}</span>
          </button>

          {/* Tombol Panduan Shortcut */}
          <button
            onClick={() => setShowShortcutModal(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-700 transition flex items-center gap-1 cursor-pointer"
            title="Lihat Pintasan Keyboard (Alt + K)"
          >
            <span>⌨️ Pintasan</span>
          </button>

          <Link
            href="/kiosk"
            target="_blank"
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-slate-700 transition flex items-center gap-1.5 shadow"
          >
            <span>Layar Kiosk</span>
            <span>↗</span>
          </Link>

          <Link
            href="/admin/laporan"
            className="bg-blue-950/60 hover:bg-blue-900/80 border border-blue-700/50 text-blue-300 text-xs font-bold px-3.5 py-2.5 rounded-xl transition flex items-center gap-1.5 shadow"
          >
            <span>Laporan</span>
            <span>📊</span>
          </Link>

          <button
            onClick={resetHarian}
            className="bg-rose-950/60 hover:bg-rose-600 border border-rose-600/50 text-rose-300 hover:text-white text-xs font-extrabold px-3.5 py-2.5 rounded-xl transition shadow cursor-pointer"
          >
            RESET HARIAN
          </button>
        </div>
      </header>

      {/* Main Container Layout Grid Layar Penuh */}
      <main className="flex-1 p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-[1920px] mx-auto">
        
        {/* Panel Utama Kontrol Pemanggil Antrean (8 Columns) */}
        <div className="lg:col-span-8 bg-slate-900/80 border border-slate-800 p-6 md:p-8 rounded-3xl shadow-2xl flex flex-col justify-between">
          <div>
            {/* Quick Switcher Loket Cepat */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pilihan Loket Cepat:</span>
              <div className="flex gap-2">
                {["1", "2", "3"].map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLoket(id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition cursor-pointer ${
                      loket === id
                        ? "bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-900/50"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    Loket {id} ({getKategoriLoket(id).kode})
                  </button>
                ))}
              </div>
            </div>

            {/* Mini Cards Statistik Lengkap 4 Kolom */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 mb-6">
              <div className={`border p-4 rounded-2xl text-center ${kategoriAktif.warna}`}>
                <p className="text-[11px] uppercase font-bold opacity-80">Kategori Aktif</p>
                <p className="text-xl md:text-2xl font-black mt-1">KAT. {kategoriAktif.kode}</p>
              </div>
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-2xl text-center">
                <p className="text-[11px] uppercase font-bold text-slate-400">Sisa Menunggu</p>
                <p className="text-xl md:text-2xl font-black text-yellow-400 mt-1">{daftarMenunggu.length} Pasien</p>
              </div>
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-2xl text-center">
                <p className="text-[11px] uppercase font-bold text-slate-400">Total Dilewati</p>
                <p className="text-xl md:text-2xl font-black text-amber-400 mt-1">{daftarDilewati.length} Pasien</p>
              </div>
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-2xl text-center">
                <p className="text-[11px] uppercase font-bold text-slate-400">Selesai Dilayani</p>
                <p className="text-xl md:text-2xl font-black text-emerald-400 mt-1">{totalSelesai} Pasien</p>
              </div>
            </div>

            {/* Tombol Utama Auto-Next + Panduan Pintas Keyboard */}
            <div className="relative mb-6">
              <button
                onClick={panggilSelanjutnya}
                disabled={loading}
                className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 active:scale-[0.99] text-white font-black p-6 rounded-2xl shadow-xl shadow-emerald-950/50 transition duration-200 text-xl md:text-3xl tracking-wider flex items-center justify-center space-x-3 border border-emerald-400/30 disabled:opacity-50 cursor-pointer"
              >
                <span>PANGGIL SELANJUTNYA ({kategoriAktif.kode})</span>
              </button>
              <span className="absolute -top-3 right-6 bg-slate-950 border border-emerald-500/50 text-emerald-400 text-xs font-bold px-3 py-1 rounded-lg shadow-md">
                Pintas: Alt + N
              </span>
            </div>

            {/* Form Panggil Manual & Pengaturan Loket */}
            <form onSubmit={panggilBaru} className="space-y-5 border-t border-slate-800 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                    Pilih Loket / Unit Anda
                  </label>
                  <select
                    value={loket}
                    onChange={(e) => setLoket(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm cursor-pointer"
                  >
                    <option value="1">Loket 1 - Pendaftaran (Kategori A)</option>
                    <option value="2">Loket 2 - Kasir (Kategori B)</option>
                    <option value="3">Loket 3 - Farmasi (Kategori C)</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      Panggil Manual (Input Kode Nomor)
                    </label>
                    <div className="flex space-x-1">
                      <button
                        type="button"
                        onClick={() => setNomor("A-")}
                        className="bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white text-[10px] font-extrabold px-2 py-0.5 rounded border border-blue-500/30 transition cursor-pointer"
                      >
                        + A-
                      </button>
                      <button
                        type="button"
                        onClick={() => setNomor("B-")}
                        className="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 hover:text-white text-[10px] font-extrabold px-2 py-0.5 rounded border border-emerald-500/30 transition cursor-pointer"
                      >
                        + B-
                      </button>
                      <button
                        type="button"
                        onClick={() => setNomor("C-")}
                        className="bg-amber-600/30 hover:bg-amber-600 text-amber-300 hover:text-white text-[10px] font-extrabold px-2 py-0.5 rounded border border-amber-500/30 transition cursor-pointer"
                      >
                        + C-
                      </button>
                      <button
                        type="button"
                        onClick={() => setNomor("P-")}
                        className="bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-extrabold px-2 py-0.5 rounded border border-rose-500/30 transition cursor-pointer"
                        title="Prioritas / Lansia"
                      >
                        + P-
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder="CONTOH: A-001"
                      value={nomor}
                      onChange={(e) => setNomor(e.target.value.toUpperCase())}
                      className="flex-grow bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xl font-black text-yellow-400 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase tracking-wider"
                    />
                    <button
                      type="submit"
                      disabled={loading || !nomor}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold px-6 py-3.5 rounded-xl shadow transition disabled:opacity-40 cursor-pointer"
                    >
                      PANGGIL
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>

          {/* Kotak Antrean Terakhir Dipanggil & Durasi Pelayanan Real-Time */}
          {terakhirDipanggil && (
            <div className="mt-6 pt-5 border-t border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950/70 p-5 rounded-2xl border border-slate-800 shadow-inner">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <p className="text-xs text-slate-400 font-bold uppercase">Sedang Dilayani:</p>
                  {jumlahRecall > 1 && (
                    <span className="text-[10px] bg-slate-800 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded font-bold">
                      Dipanggil {jumlahRecall}x
                    </span>
                  )}
                  {/* Timer Durasi Pelayanan */}
                  <span className="text-[11px] bg-blue-950 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded font-mono font-bold">
                    ⏱️ {formatDurasi(durasiPelayanan)}
                  </span>
                </div>
                <p className="text-3xl font-black text-yellow-400 tracking-wider mt-0.5">{terakhirDipanggil}</p>
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={selesaikanPelayanan}
                  title="Pintas: Alt + D"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold px-4 py-3 rounded-xl transition shadow cursor-pointer flex items-center gap-1"
                >
                  <span>SELESAI</span>
                  <span className="opacity-70 text-[10px]">(Alt+D)</span>
                </button>

                {/* Fitur Multi-Oper: Kirim ke Kasir (B) atau Farmasi (C) */}
                <button
                  onClick={() => transferAntrean("B")}
                  className="bg-blue-900/40 hover:bg-blue-600 text-blue-200 border border-blue-500/40 text-xs font-extrabold px-3.5 py-3 rounded-xl transition cursor-pointer"
                  title="Oper antrean ke Kasir (Kategori B)"
                >
                  OPER KASIR (B) ↪️
                </button>
                <button
                  onClick={() => transferAntrean("C")}
                  className="bg-amber-900/40 hover:bg-amber-600 text-amber-200 border border-amber-500/40 text-xs font-extrabold px-3.5 py-3 rounded-xl transition cursor-pointer"
                  title="Oper antrean ke Farmasi (Kategori C)"
                >
                  OPER FARMASI (C) ↪️
                </button>

                <button
                  onClick={() => lewatiAntrean(terakhirDipanggil)}
                  disabled={loading}
                  title="Pintas: Alt + S"
                  className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-extrabold px-4 py-3 rounded-xl transition shadow cursor-pointer"
                >
                  SKIP
                </button>
                <button
                  onClick={() => kirimPanggilan(terakhirDipanggil)}
                  disabled={loading}
                  title="Pintas: Alt + R"
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-extrabold px-4 py-3 rounded-xl transition shadow border border-slate-700 cursor-pointer"
                >
                  RECALL
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Daftar Antrean (4 Columns) */}
        <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 p-6 rounded-3xl shadow-2xl flex flex-col justify-between h-full min-h-[550px]">
          <div>
            {/* Header Tab Pilihan */}
            <div className="flex border-b border-slate-800 mb-4 pb-3 gap-2">
              <button
                onClick={() => setTabAktif("menunggu")}
                className={`flex-1 text-xs font-black py-3 rounded-xl transition ${
                  tabAktif === "menunggu"
                    ? "bg-blue-600 text-white shadow"
                    : "bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                MENUNGGU ({daftarMenunggu.length})
              </button>
              <button
                onClick={() => setTabAktif("dilewati")}
                className={`flex-1 text-xs font-black py-3 rounded-xl transition ${
                  tabAktif === "dilewati"
                    ? "bg-amber-600 text-white shadow"
                    : "bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                DILEWATI ({daftarDilewati.length})
              </button>
            </div>

            {/* Indikator Peringatan Lonjakan Beban Antrean (Peak Hour Alert > 15 Pasien) */}
            {daftarMenunggu.length > 15 && (
              <div className="mb-3 bg-rose-950/60 border border-rose-700/50 p-2.5 rounded-xl flex items-center space-x-2 text-rose-300 text-xs font-bold animate-pulse">
                <span>⚠️</span>
                <span>Peringatan: Antrean padat ({daftarMenunggu.length} pasien menunggu)!</span>
              </div>
            )}

            {/* Opsi Toggle Filter Kategori Loket Ini */}
            <div className="flex items-center justify-between mb-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-slate-300">
                Filter Kategori {kategoriAktif.kode} Saja
              </span>
              <button
                type="button"
                onClick={() => setHanyaKategoriIni(!hanyaKategoriIni)}
                className={`w-9 h-5 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                  hanyaKategoriIni ? "bg-blue-600" : "bg-slate-700"
                }`}
              >
                <div
                  className={`bg-white w-3.5 h-3.5 rounded-full shadow-md transform transition-transform ${
                    hanyaKategoriIni ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Input Pencarian Cepat */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Cari nomor antrean..."
                value={pencarian}
                onChange={(e) => setPencarian(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Konten Tab Antrean Menunggu */}
            {tabAktif === "menunggu" && (
              <div className="space-y-2.5 max-h-[calc(100vh-340px)] min-h-[300px] overflow-y-auto pr-1">
                {daftarMenungguFiltered.length === 0 ? (
                  <div className="text-slate-500 text-xs text-center py-16 flex flex-col items-center gap-2">
                    <span className="text-2xl">📋</span>
                    <p>{pencarian ? "Nomor tidak ditemukan" : "Belum ada antrean baru yang menunggu."}</p>
                  </div>
                ) : (
                  daftarMenungguFiltered.map((item, idx) => {
                    const infoWaktu = formatWaktuTiket(item.waktu_panggil);
                    return (
                      <div
                        key={item.id}
                        onClick={() => setNomor(item.nomor_antrean)}
                        className="bg-slate-950 border border-slate-800 hover:border-blue-500 p-3.5 rounded-xl flex items-center justify-between cursor-pointer transition group"
                      >
                        <div className="flex items-center space-x-3">
                          <span className={`text-xs font-black px-2.5 py-1 rounded-md border ${getBadgeWarna(item.nomor_antrean)}`}>
                            {item.nomor_antrean}
                          </span>
                          <div>
                            <p className="text-[11px] text-slate-300 font-semibold">
                              {infoWaktu.jam} {infoWaktu.tanggal && <span className="text-[10px] text-slate-500">({infoWaktu.tanggal})</span>}
                            </p>
                            <p className="text-[9px] font-mono text-slate-500">Est. ~{idx * 3} mnt</p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            lewatiAntrean(item.nomor_antrean);
                          }}
                          className="bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-white text-[10px] font-extrabold px-2.5 py-1.5 rounded-lg border border-amber-500/30 transition cursor-pointer"
                        >
                          SKIP
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Konten Tab Antrean Dilewati */}
            {tabAktif === "dilewati" && (
              <div className="space-y-2.5 max-h-[calc(100vh-340px)] min-h-[300px] overflow-y-auto pr-1">
                {daftarDilewatiFiltered.length === 0 ? (
                  <div className="text-slate-500 text-xs text-center py-16 flex flex-col items-center gap-2">
                    <span className="text-2xl">⏭️</span>
                    <p>{pencarian ? "Nomor tidak ditemukan" : "Tidak ada antrean yang dilewati."}</p>
                  </div>
                ) : (
                  daftarDilewatiFiltered.map((item) => {
                    const infoWaktu = formatWaktuTiket(item.waktu_panggil);
                    return (
                      <div
                        key={item.id}
                        className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-3">
                          <span className={`text-xs font-black px-2.5 py-1 rounded-md border ${getBadgeWarna(item.nomor_antrean)}`}>
                            {item.nomor_antrean}
                          </span>
                          <div>
                            <p className="text-[11px] text-slate-300 font-semibold">{infoWaktu.jam}</p>
                            <p className="text-[9px] text-slate-500">Dilewati</p>
                          </div>
                        </div>
                        <button
                          onClick={() => kirimPanggilan(item.nomor_antrean)}
                          className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold px-3.5 py-1.5 rounded-lg transition shadow cursor-pointer"
                        >
                          PANGGIL
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <button
            onClick={muatSemuaData}
            className="mt-4 w-full bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-extrabold py-3 rounded-xl transition border border-slate-700 cursor-pointer"
          >
            REFRESH DAFTAR
          </button>
        </div>

      </main>
    </div>
  );
}