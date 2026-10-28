"use client";

import { useEffect, useState, useRef } from "react";
import Pusher from "pusher-js";

interface AntreanData {
  nomor: string;
  loket: string;
  status?: string;
}

// ==========================================
// FUNGSI TERBILANG BAHASA INDONESIA LENGKAP
// ==========================================

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

  if (n < 12) {
    return satuan[n];
  } else if (n < 20) {
    return terbilang(n - 10) + " belas";
  } else if (n < 100) {
    return (terbilang(Math.floor(n / 10)) + " puluh " + terbilang(n % 10)).trim();
  } else if (n < 200) {
    return ("seratus " + terbilang(n % 100)).trim();
  } else if (n < 1000) {
    return (terbilang(Math.floor(n / 100)) + " ratus " + terbilang(n % 100)).trim();
  } else if (n < 2000) {
    return ("seribu " + terbilang(n % 1000)).trim();
  } else if (n < 1000000) {
    return (terbilang(Math.floor(n / 1000)) + " ribu " + terbilang(n % 1000)).trim();
  } else {
    return n.toString();
  }
}

function formatNomorAntreanTTS(nomorAntrean: string): string {
  if (!nomorAntrean || nomorAntrean === "---") return "";

  const cleanNomor = nomorAntrean.trim().toUpperCase();
  const match = cleanNomor.match(/^([A-Z]+)[-]?(\d+)$/);

  if (match) {
    const kodeHuruf = match[1];
    const angkaInt = parseInt(match[2], 10);
    const sebutanAngka = terbilang(angkaInt);

    return `${kodeHuruf}, ${sebutanAngka}`;
  }

  return cleanNomor.split("").join(" ");
}

export default function KioskPage() {
  const [antrean, setAntrean] = useState<AntreanData>({ nomor: "---", loket: "-" });
  const [riwayat, setRiwayat] = useState<AntreanData[]>([]);
  const [waktu, setWaktu] = useState<string>("");
  const [loadingCetak, setLoadingCetak] = useState(false);
  const [kategoriLoading, setKategoriLoading] = useState<string | null>(null);
  const [tiketBaru, setTiketBaru] = useState<{ nomor: string; waktu: string } | null>(null);

  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(true);
  const [showModalTiket, setShowModalTiket] = useState<boolean>(false);
  const [sisaAntrean, setSisaAntrean] = useState<{ A: number; B: number; C: number; P: number }>({
    A: 0,
    B: 0,
    C: 0,
    P: 0,
  });

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState<boolean>(true);

  const [voiceRate, setVoiceRate] = useState<number>(0.85);
  const [showVoiceSettings, setShowVoiceSettings] = useState<boolean>(false);
  const [totalTiketHariIni, setTotalTiketHariIni] = useState<number>(0);

  const [runningIndex, setRunningIndex] = useState<number>(0);
  const [isTtsSupported, setIsTtsSupported] = useState<boolean>(true);

  const [isPrinterReady, setIsPrinterReady] = useState<boolean>(true);
  const [isAudioUnlocked, setIsAudioUnlocked] = useState<boolean>(false);
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">("80mm");

  const [isCallFlashing, setIsCallFlashing] = useState<boolean>(false);
  const isCetakDebounce = useRef<boolean>(false);

  const audioQueueRef = useRef<Array<{ nomor: string; loket: string }>>([]);
  const isSpeakingRef = useRef<boolean>(false);

  const pesanInformasi = [
    "Selamat Datang di RSUD Bukit Kerman Kabupaten Kerinci • Utamakan Keselamatan & Ketertiban • Mohon Menunggu Nomor Antrean Dipanggil",
    "Pendaftaran Poliklinik Buka Setiap Hari Kerja • Harap Menyiapkan KTP / Kartu BPJS Kesehatan / Surat Rujukan",
    "Budayakan Mengantre dengan Tertib • Selalu Jaga Kebersihan Lingkungan Rumah Sakit • Salam Sehat RSUD Bukit Kerman",
  ];

  const totalMenunggu = sisaAntrean.A + sisaAntrean.B + sisaAntrean.C + sisaAntrean.P;

  const unlockAudioContext = () => {
    if (isAudioUnlocked) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === "suspended") {
          ctx.resume();
        }
      }
      setIsAudioUnlocked(true);
    } catch (e) {
      // Fallback
    }
  };

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

      if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() === 0) {
        setAntrean({ nomor: "---", loket: "-" });
        setRiwayat([]);
        setTotalTiketHariIni(0);
      }
    }, 1000);

    const timerRunning = setInterval(() => {
      setRunningIndex((prev) => (prev + 1) % pesanInformasi.length);
    }, 15000);

    if (typeof window !== "undefined" && !("speechSynthesis" in window)) {
      setIsTtsSupported(false);
    }

    const disableContextMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", disableContextMenu);

    return () => {
      clearInterval(timer);
      clearInterval(timerRunning);
      document.removeEventListener("contextmenu", disableContextMenu);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      }
    }
  };

  const ambilSisaAntrean = async () => {
    try {
      const res = await fetch("/api/antrean-menunggu");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const hitung = { A: 0, B: 0, C: 0, P: 0 };
        json.data.forEach((item: { nomor_antrean: string }) => {
          if (item.nomor_antrean.startsWith("A")) hitung.A++;
          else if (item.nomor_antrean.startsWith("B")) hitung.B++;
          else if (item.nomor_antrean.startsWith("C")) hitung.C++;
          else if (item.nomor_antrean.startsWith("P")) hitung.P++;
        });
        setSisaAntrean(hitung);
        setTotalTiketHariIni(json.data.length);
      }
    } catch (err) {
      console.error("Gagal mengambil data sisa antrean:", err);
    }
  };

  const ambilRiwayatAwal = async () => {
    try {
      const res = await fetch("/api/riwayat");
      const json = await res.json();
      if (json.success && json.data.length > 0) {
        setAntrean(json.data[0]);
        setRiwayat(json.data);
      }
    } catch (err) {
      console.error("Gagal mengambil data awal:", err);
    }
  };

  useEffect(() => {
    ambilRiwayatAwal();
    ambilSisaAntrean();

    const intervalSisa = setInterval(ambilSisaAntrean, 10000);
    return () => clearInterval(intervalSisa);
  }, []);

  useEffect(() => {
    if (isSocketConnected) return;
    const fallbackInterval = setInterval(() => {
      ambilRiwayatAwal();
      ambilSisaAntrean();
    }, 4000);
    return () => clearInterval(fallbackInterval);
  }, [isSocketConnected]);

  const bunyikanChime = () => {
    if (!isAudioEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
      gain1.gain.setValueAtTime(0.2, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.3);

      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(523.25, ctx.currentTime);
        gain2.gain.setValueAtTime(0.2, ctx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.4);
      }, 200);

    } catch (e) {
      // Fallback
    }
  };

  const bunyikanBeepKlik = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1046.50, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // Fallback
    }
  };

  const processAudioQueue = () => {
    if (isSpeakingRef.current || audioQueueRef.current.length === 0 || !isAudioEnabled || !("speechSynthesis" in window)) {
      return;
    }

    const item = audioQueueRef.current.shift();
    if (!item) return;

    isSpeakingRef.current = true;
    window.speechSynthesis.cancel();
    bunyikanChime();

    setTimeout(() => {
      const sebutanJelas = formatNomorAntreanTTS(item.nomor);
      const namaLoket = item.loket.toLowerCase().includes("loket") ? item.loket : "loket " + item.loket;
      const teks = `Nomor antrean, ${sebutanJelas}, silakan menuju ke ${namaLoket}`;
      
      const utterance = new SpeechSynthesisUtterance(teks);
      utterance.lang = "id-ID";
      utterance.rate = voiceRate;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const indonesianVoice = voices.find((v) => v.lang.includes("id") || v.lang.includes("ID"));
      if (indonesianVoice) {
        utterance.voice = indonesianVoice;
      }
      
      utterance.onend = () => {
        isSpeakingRef.current = false;
        setTimeout(processAudioQueue, 300);
      };

      utterance.onerror = () => {
        isSpeakingRef.current = false;
        setTimeout(processAudioQueue, 300);
      };

      window.speechSynthesis.speak(utterance);
    }, 500);
  };

  const panggilSuara = (nomor: string, loket: string) => {
    audioQueueRef.current.push({ nomor, loket });
    processAudioQueue();
  };

  const handleUlangiPanggilan = () => {
    if (antrean.nomor !== "---" && antrean.loket !== "-") {
      panggilSuara(antrean.nomor, antrean.loket);
    }
  };

  const handlePanggilDariRiwayat = (item: AntreanData) => {
    unlockAudioContext();
    bunyikanBeepKlik();
    setAntrean(item);

    setIsCallFlashing(true);
    setTimeout(() => setIsCallFlashing(false), 3000);

    panggilSuara(item.nomor, item.loket);
  };

  const handleSyncManual = () => {
    bunyikanBeepKlik();
    ambilRiwayatAwal();
    ambilSisaAntrean();
  };

  useEffect(() => {
    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });

    const channel = pusher.subscribe("antrean-channel");
    
    pusher.connection.bind("connected", () => setIsSocketConnected(true));
    pusher.connection.bind("disconnected", () => setIsSocketConnected(false));

    channel.bind("event-panggil", (data: { nomor_antrean: string; loket: string; status?: string }) => {
      const dataBaru = { nomor: data.nomor_antrean, loket: data.loket, status: data.status };
      setAntrean(dataBaru);
      setRiwayat((prev) => [dataBaru, ...prev.slice(0, 4)]);
      
      setIsCallFlashing(true);
      setTimeout(() => setIsCallFlashing(false), 3000);

      panggilSuara(data.nomor_antrean, data.loket);
      ambilSisaAntrean();
    });

    return () => {
      pusher.unsubscribe("antrean-channel");
    };
  }, [isAudioEnabled, voiceRate]);

  const handleAmbilTiket = async (kategori: string) => {
    if (loadingCetak || isCetakDebounce.current) return;
    isCetakDebounce.current = true;
    unlockAudioContext();
    bunyikanBeepKlik();
    setLoadingCetak(true);
    setKategoriLoading(kategori);

    try {
      const res = await fetch("/api/cetak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kategori }),
      });

      const data = await res.json();
      if (data.success) {
        const infoTiket = {
          nomor: data.nomor_antrean,
          waktu: new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }),
        };
        setTiketBaru(infoTiket);
        setShowModalTiket(true);
        ambilSisaAntrean();

        setTimeout(() => {
          window.print();
        }, 400);

        setTimeout(() => {
          setShowModalTiket(false);
        }, 5000);
      } else {
        alert("Gagal mengambil tiket: " + data.message);
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi server");
    } finally {
      setLoadingCetak(false);
      setKategoriLoading(null);
      setTimeout(() => {
        isCetakDebounce.current = false;
      }, 1500);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "a" || key === "1") {
        handleAmbilTiket("A");
      } else if (key === "b" || key === "2") {
        handleAmbilTiket("B");
      } else if (key === "c" || key === "3") {
        handleAmbilTiket("C");
      } else if (key === "p" || key === "4") {
        handleAmbilTiket("P");
      } else if (key === "f") {
        toggleFullscreen();
      } else if (key === "r") {
        handleUlangiPanggilan();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loadingCetak, antrean]);

  return (
    <div 
      onClick={unlockAudioContext}
      className={`min-h-screen flex flex-col justify-between p-4 sm:p-6 select-none font-sans relative transition-colors duration-300 ${
        isDarkMode ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-900"
      }`}
    >
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          @page {
            margin: 0;
            size: auto;
          }
        }
      `}</style>
      
      {showModalTiket && tiketBaru && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 print:hidden">
          <div className={`border-4 p-8 rounded-3xl max-w-md w-full text-center shadow-2xl space-y-5 animate-bounce ${
            isDarkMode ? "bg-slate-900 border-emerald-400" : "bg-white border-emerald-500"
          }`}>
            <span className="text-5xl">🎟️</span>
            <h3 className="text-2xl font-black text-emerald-500 tracking-wide">TIKET BERHASIL DICETAK!</h3>
            <p className={`text-sm font-bold ${isDarkMode ? "text-slate-100" : "text-slate-700"}`}>
              Silakan ambil struk cetak Anda pada mesin printer.
            </p>
            <div className={`border-2 p-6 rounded-2xl shadow-inner ${
              isDarkMode ? "bg-black border-amber-400" : "bg-slate-50 border-amber-500"
            }`}>
              <p className="text-xs font-black uppercase text-amber-500 tracking-wider">Nomor Antrean Anda</p>
              <p className="text-6xl font-black text-yellow-500 my-2 tracking-wider">{tiketBaru.nomor}</p>
              <p className={`text-xs font-mono font-bold ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                {tiketBaru.waktu}
              </p>
            </div>
            <button
              onClick={() => setShowModalTiket(false)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base py-3.5 rounded-xl transition cursor-pointer shadow-lg"
            >
              TUTUP PRATINJAU
            </button>
          </div>
        </div>
      )}

      {showVoiceSettings && (
        <div className="fixed top-24 right-6 z-40 bg-slate-900 border-2 border-purple-500 p-5 rounded-2xl shadow-2xl text-white space-y-4 w-72 print:hidden">
          <h4 className="text-xs font-black uppercase text-purple-400 tracking-wider flex items-center justify-between">
            <span>⚙️ Pengaturan Kios</span>
            <button onClick={() => setShowVoiceSettings(false)} className="text-slate-400 hover:text-white">✕</button>
          </h4>
          
          <div className="space-y-1">
            <label className="text-xs text-slate-300">Kecepatan Suara ({voiceRate}x):</label>
            <input
              type="range"
              min="0.5"
              max="1.2"
              step="0.05"
              value={voiceRate}
              onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
              className="w-full accent-purple-500 cursor-pointer"
            />
          </div>

          <div className="space-y-1 pt-2 border-t border-slate-800">
            <label className="text-xs text-slate-300">Lebar Kertas Thermal Printer:</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                onClick={() => setPaperWidth("58mm")}
                className={`py-1.5 rounded-lg text-xs font-bold border ${paperWidth === "58mm" ? "bg-purple-600 border-purple-400 text-white" : "bg-slate-800 border-slate-700 text-slate-400"}`}
              >
                58 mm
              </button>
              <button
                onClick={() => setPaperWidth("80mm")}
                className={`py-1.5 rounded-lg text-xs font-bold border ${paperWidth === "80mm" ? "bg-purple-600 border-purple-400 text-white" : "bg-slate-800 border-slate-700 text-slate-400"}`}
              >
                80 mm
              </button>
            </div>
          </div>

          <button
            onClick={() => setShowVoiceSettings(false)}
            className="w-full bg-purple-700 hover:bg-purple-600 text-xs font-black py-2 rounded-lg transition"
          >
            Simpan & Tutup
          </button>
        </div>
      )}

      <header className={`print:hidden border-2 rounded-2xl p-4 sm:p-6 flex flex-wrap justify-between items-center shadow-2xl gap-4 transition-colors ${
        isDarkMode ? "bg-slate-900 border-slate-700" : "bg-white border-slate-300 shadow-slate-200"
      }`}>
        <div className="flex items-center space-x-4">
          <div className="bg-blue-600 text-white font-black p-3.5 rounded-2xl text-3xl tracking-wider shadow-lg shadow-blue-900/40 border-2 border-white">
            RSUD
          </div>
          <div>
            <h1 className={`text-2xl sm:text-3xl font-black tracking-wider flex items-center gap-3 ${
              isDarkMode ? "text-white" : "text-slate-900"
            }`}>
              <span>RSUD BUKIT KERMAN</span>
              <span className={`text-xs font-black px-3 py-1 rounded-full border-2 ${
                isSocketConnected 
                  ? "bg-emerald-500 text-black border-white" 
                  : "bg-rose-600 text-white border-white animate-pulse"
              }`}>
                {isSocketConnected ? "● LIVE SYNC" : "○ RECONNECTING"}
              </span>
            </h1>
            <p className={`text-sm font-bold mt-0.5 flex flex-wrap items-center gap-2 ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
              <span>Sistem Informasi & Anjungan Mandiri Antrean Pelayanan Kesehatan</span>
              <span className="text-xs bg-blue-950 text-blue-300 px-2.5 py-0.5 rounded-full border border-blue-700/50 font-mono">
                Hari Ini: {totalTiketHariIni} Tiket
              </span>
              <span className={`text-xs px-2.5 py-0.5 rounded-full border font-mono ${
                isPrinterReady ? "bg-emerald-950 text-emerald-300 border-emerald-700/50" : "bg-rose-950 text-rose-300 border-rose-700/50"
              }`}>
                🖨️ Printer Ready ({paperWidth})
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleSyncManual}
            className={`p-3 rounded-xl border-2 font-black text-xs transition flex items-center gap-1.5 cursor-pointer ${
              isDarkMode ? "bg-slate-800 text-blue-300 border-slate-600 hover:bg-slate-700" : "bg-slate-200 text-blue-800 border-slate-300 hover:bg-slate-300"
            }`}
            title="Resinkronkan Data Kiosk"
          >
            <span>🔄 Sync</span>
          </button>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => setIsAudioEnabled(!isAudioEnabled)}
              className={`p-3 rounded-l-xl border-2 border-r-0 font-black text-xs transition flex items-center gap-1.5 cursor-pointer ${
                isAudioEnabled 
                  ? "bg-purple-600 text-white border-purple-400" 
                  : "bg-slate-700 text-slate-300 border-slate-500"
              }`}
              title="Toggle Suara Panggilan"
            >
              <span>{isAudioEnabled ? "🔊 Sound ON" : "🔇 Sound OFF"}</span>
            </button>
            <button
              onClick={() => setShowVoiceSettings(!showVoiceSettings)}
              className="p-3 bg-purple-800 text-white border-2 border-purple-400 rounded-r-xl font-black text-xs hover:bg-purple-700 transition cursor-pointer"
              title="Pengaturan Kios"
            >
              ⚙️
            </button>
          </div>

          <button
            onClick={toggleFullscreen}
            className={`p-3 rounded-xl border-2 font-black text-xs transition flex items-center gap-1.5 cursor-pointer ${
              isDarkMode ? "bg-slate-800 text-white border-slate-600 hover:bg-slate-700" : "bg-slate-200 text-slate-900 border-slate-300 hover:bg-slate-300"
            }`}
            title="Toggle Mode Fullscreen"
          >
            <span>{isFullscreen ? "↙️ Normal" : "⛶ Fullscreen"}</span>
          </button>

          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-3 rounded-xl border-2 font-black text-xs transition flex items-center gap-1.5 cursor-pointer ${
              isDarkMode ? "bg-amber-500 text-black border-yellow-300" : "bg-slate-900 text-yellow-400 border-slate-700"
            }`}
            title="Ganti Mode Tampilan Mode Gelap / Terang"
          >
            <span>{isDarkMode ? "☀️ Mode Terang" : "🌙 Mode Gelap"}</span>
          </button>

          <div className={`border-2 px-5 py-2 rounded-2xl text-right shadow-md ${
            isDarkMode ? "bg-black border-yellow-400" : "bg-slate-950 border-blue-600 text-white"
          }`}>
            <p className="text-[10px] text-yellow-400 font-black uppercase tracking-widest">Waktu WIB</p>
            <p className="text-2xl font-mono font-black text-yellow-300 tracking-wider">{waktu || "00:00:00"}</p>
          </div>
        </div>
      </header>

      {!isTtsSupported && (
        <div className="print:hidden my-2 bg-amber-600 text-black font-black text-xs py-2 px-4 rounded-xl border-2 border-white text-center">
          ⚠️ Perhatian: Fitur Text-to-Speech (TTS) tidak didukung pada browser kiosk ini. Fitur audio chime tetap aktif.
        </div>
      )}

      <main className="print:hidden grid grid-cols-1 lg:grid-cols-3 gap-6 my-6 flex-grow">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className={`border-4 rounded-3xl p-6 flex flex-col items-center justify-center text-center shadow-2xl relative overflow-hidden flex-grow min-h-[300px] transition-all duration-300 ${
            isCallFlashing ? "ring-8 ring-yellow-400 scale-[1.01]" : ""
          } ${
            isDarkMode 
              ? "bg-gradient-to-b from-slate-900 via-slate-950 to-black border-yellow-400/80" 
              : "bg-gradient-to-b from-blue-900 via-slate-900 to-black border-blue-500 text-white"
          }`}>
            <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -z-10"></div>
            
            <div className="flex flex-wrap justify-center items-center gap-3 mb-2">
              <span className="bg-yellow-400 text-black text-sm font-black uppercase tracking-widest px-6 py-2 rounded-full shadow-lg border-2 border-white">
                PANGGILAN AKTIF DIPANGGIL
              </span>
              
              <span className={`text-xs font-black px-4 py-1.5 rounded-full border-2 ${
                totalMenunggu > 20 
                  ? "bg-rose-600 text-white border-white animate-bounce" 
                  : totalMenunggu > 10 
                  ? "bg-amber-500 text-black border-white" 
                  : "bg-emerald-500 text-black border-white"
              }`}>
                {totalMenunggu > 20 ? "🔥 Ruang Tunggu Padat" : totalMenunggu > 10 ? "⚠️ Antrean Sedang" : "✅ Antrean Lancar"}
              </span>

              <button
                onClick={handleUlangiPanggilan}
                className="bg-purple-600 hover:bg-purple-500 active:scale-95 text-white text-xs font-black px-4 py-1.5 rounded-full border-2 border-white shadow-md cursor-pointer transition"
                title="Panggil Ulang Suara Antrean Active"
              >
                📢 Ulangi Suara (R)
              </button>
            </div>
            
            <div className="text-8xl md:text-[10rem] font-black tracking-tight text-yellow-300 my-2 drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)] leading-none">
              {antrean.nomor}
            </div>
            
            <div className="bg-blue-900 border-2 border-white px-8 py-3.5 rounded-2xl shadow-xl">
              <p className="text-xl md:text-2xl text-white font-extrabold tracking-wide">
                SILAKAN MENUJU <span className="text-yellow-300 font-black text-3xl ml-2 underline underline-offset-4">
                  {antrean.loket.toUpperCase().includes("LOKET") ? antrean.loket : `LOKET ${antrean.loket}`}
                </span>
              </p>
            </div>
          </div>

          <div className={`border-2 rounded-3xl p-6 shadow-2xl transition-colors ${
            isDarkMode ? "bg-slate-900 border-slate-700" : "bg-white border-slate-300"
          }`}>
            <h3 className={`text-base font-black mb-4 text-center uppercase tracking-wider flex items-center justify-center gap-2 ${
              isDarkMode ? "text-yellow-300" : "text-blue-900"
            }`}>
              <span>🎟️</span> TEKAN TOMBOL ATAU PINTASAN KEYBOARD (1/2/3/4) UNTUK TIKET
            </h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <button
                onClick={() => handleAmbilTiket("A")}
                disabled={loadingCetak}
                className="bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black p-5 rounded-2xl shadow-xl transition duration-150 flex flex-col items-center justify-center border-4 border-white disabled:opacity-50 cursor-pointer relative group"
              >
                {kategoriLoading === "A" && (
                  <div className="absolute inset-0 bg-blue-800/90 rounded-2xl flex items-center justify-center">
                    <span className="text-xs font-black animate-spin">⌛ Memproses...</span>
                  </div>
                )}
                <span className="text-xs text-blue-100 uppercase tracking-wider font-extrabold">PENDAFTARAN (1/A)</span>
                <span className="text-2xl font-black mt-1 text-white">LOKET A</span>
                <span className="text-xs bg-yellow-400 text-black font-black px-3 py-1 rounded-full mt-3 shadow-md">
                  Sisa: {sisaAntrean.A} Pasien
                </span>
                <span className="text-[10px] text-blue-200 mt-1 font-mono font-bold">Est. ~{sisaAntrean.A * 3} mnt</span>
              </button>

              <button
                onClick={() => handleAmbilTiket("B")}
                disabled={loadingCetak}
                className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black p-5 rounded-2xl shadow-xl transition duration-150 flex flex-col items-center justify-center border-4 border-white disabled:opacity-50 cursor-pointer relative group"
              >
                {kategoriLoading === "B" && (
                  <div className="absolute inset-0 bg-emerald-800/90 rounded-2xl flex items-center justify-center">
                    <span className="text-xs font-black animate-spin">⌛ Memproses...</span>
                  </div>
                )}
                <span className="text-xs text-emerald-100 uppercase tracking-wider font-extrabold">KASIR (2/B)</span>
                <span className="text-2xl font-black mt-1 text-white">LOKET B</span>
                <span className="text-xs bg-yellow-400 text-black font-black px-3 py-1 rounded-full mt-3 shadow-md">
                  Sisa: {sisaAntrean.B} Pasien
                </span>
                <span className="text-[10px] text-emerald-200 mt-1 font-mono font-bold">Est. ~{sisaAntrean.B * 3} mnt</span>
              </button>

              <button
                onClick={() => handleAmbilTiket("C")}
                disabled={loadingCetak}
                className="bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-black p-5 rounded-2xl shadow-xl transition duration-150 flex flex-col items-center justify-center border-4 border-white disabled:opacity-50 cursor-pointer relative group"
              >
                {kategoriLoading === "C" && (
                  <div className="absolute inset-0 bg-amber-800/90 rounded-2xl flex items-center justify-center">
                    <span className="text-xs font-black animate-spin">⌛ Memproses...</span>
                  </div>
                )}
                <span className="text-xs text-amber-100 uppercase tracking-wider font-extrabold">FARMASI (3/C)</span>
                <span className="text-2xl font-black mt-1 text-white">LOKET C</span>
                <span className="text-xs bg-yellow-400 text-black font-black px-3 py-1 rounded-full mt-3 shadow-md">
                  Sisa: {sisaAntrean.C} Pasien
                </span>
                <span className="text-[10px] text-amber-200 mt-1 font-mono font-bold">Est. ~{sisaAntrean.C * 3} mnt</span>
              </button>

              <button
                onClick={() => handleAmbilTiket("P")}
                disabled={loadingCetak}
                className="bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black p-5 rounded-2xl shadow-xl transition duration-150 flex flex-col items-center justify-center border-4 border-white disabled:opacity-50 cursor-pointer relative group"
              >
                {kategoriLoading === "P" && (
                  <div className="absolute inset-0 bg-rose-800/90 rounded-2xl flex items-center justify-center">
                    <span className="text-xs font-black animate-spin">⌛ Memproses...</span>
                  </div>
                )}
                <span className="text-xs text-rose-100 uppercase tracking-wider font-extrabold">PRIORITAS (4/P)</span>
                <span className="text-2xl font-black mt-1 text-white">LOKET P</span>
                <span className="text-xs bg-yellow-400 text-black font-black px-3 py-1 rounded-full mt-3 shadow-md">
                  Sisa: {sisaAntrean.P} Pasien
                </span>
                <span className="text-[10px] text-rose-200 mt-1 font-mono font-bold">Est. ~{sisaAntrean.P * 3} mnt</span>
              </button>
            </div>
          </div>
        </div>

        <div className={`border-2 rounded-3xl p-6 flex flex-col shadow-2xl transition-colors ${
          isDarkMode ? "bg-slate-900 border-slate-700" : "bg-white border-slate-300"
        }`}>
          <h2 className={`text-xl font-black mb-4 pb-3 border-b-2 flex items-center justify-between ${
            isDarkMode ? "text-white border-slate-700" : "text-slate-900 border-slate-200"
          }`}>
            <span>Riwayat Panggilan</span>
            <span className="text-xs bg-yellow-400 text-black font-black px-3 py-1 rounded-full uppercase">Terakhir</span>
          </h2>
          
          <div className="space-y-3.5 overflow-y-auto flex-grow">
            {riwayat.length === 0 ? (
              <p className={`text-base font-bold text-center py-12 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                Belum ada antrean dipanggil
              </p>
            ) : (
              riwayat.map((item, idx) => {
                const isSkipped = item.loket.toLowerCase().includes("skip") || item.status === "SKIP";
                return (
                  <div
                    key={idx}
                    onClick={() => handlePanggilDariRiwayat(item)}
                    className={`border-2 rounded-2xl p-4 flex justify-between items-center shadow-md cursor-pointer hover:scale-[1.02] active:scale-95 transition-all ${
                      isDarkMode ? "bg-slate-950 border-slate-700 hover:border-yellow-400" : "bg-slate-50 border-slate-300 hover:border-blue-500"
                    }`}
                    title="Klik untuk memanggil ulang antrean ini"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-black text-yellow-500 tracking-wider">{item.nomor}</span>
                      <span className="text-xs opacity-60">📢</span>
                    </div>
                    <span className={`text-sm font-black px-4 py-2 rounded-xl border border-white ${
                      isSkipped ? "bg-rose-600 text-white" : "bg-blue-600 text-white"
                    }`}>
                      {item.loket.toUpperCase().includes("LOKET") ? item.loket : `LOKET ${item.loket}`}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      <footer className="print:hidden bg-blue-600 border-2 border-white rounded-2xl p-3.5 text-center overflow-hidden shadow-2xl relative">
        <div className="whitespace-nowrap inline-block animate-[marquee_25s_linear_infinite]">
          <p className="text-base font-black text-white tracking-wider">
            {pesanInformasi[runningIndex]}
          </p>
        </div>
      </footer>

      {tiketBaru && (
        <div className={`hidden print:block font-mono text-black text-center p-2 mx-auto leading-tight ${
          paperWidth === "58mm" ? "max-w-[58mm] text-[10px]" : "max-w-[80mm]"
        }`}>
          <h2 className="text-lg font-bold uppercase border-b border-black pb-1 mb-2">
            RSUD BUKIT KERMAN
          </h2>
          <p className="text-xs font-bold uppercase mb-2">TIKET ANTREAN PELAYANAN</p>
          <p className="text-xs">NOMOR ANTREAN ANDA:</p>
          <div className="text-5xl font-black my-3 border-y-2 border-black py-2">
            {tiketBaru.nomor}
          </div>
          
          <div className="my-2 flex flex-col items-center justify-center">
            <div className="h-8 w-44 bg-slate-950 flex items-center justify-around px-1">
              <div className="w-1 h-full bg-white"></div>
              <div className="w-2 h-full bg-white"></div>
              <div className="w-1 h-full bg-slate-950"></div>
              <div className="w-3 h-full bg-white"></div>
              <div className="w-1 h-full bg-white"></div>
              <div className="w-2 h-full bg-slate-950"></div>
              <div className="w-1 h-full bg-white"></div>
              <div className="w-3 h-full bg-white"></div>
            </div>
            <span className="text-[8px] font-mono tracking-widest mt-0.5">{tiketBaru.nomor}</span>
          </div>

          <p className="text-[10px] mb-4">
            Mohon menunggu nomor antrean Anda dipanggil di ruang tunggu.
          </p>
          <p className="text-[9px] border-t border-black pt-2">
            {tiketBaru.waktu}
          </p>
        </div>
      )}
    </div>
  );
}