import { NextResponse, NextRequest } from 'next/server';
import { Pool } from 'pg';
import Pusher from 'pusher';

// Mencegah pembuatan pool baru secara berulang saat Next.js melakukan hot-reload di mode development
const globalForPool = globalThis as unknown as { pgPool: Pool };

const pool =
  globalForPool.pgPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

if (process.env.NODE_ENV !== 'production') globalForPool.pgPool = pool;

// Inisialisasi Pusher Server
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  useTLS: true,
});

export async function POST(req: NextRequest) {
  let client;

  try {
    const body = await req.json().catch(() => ({}));
    const nomor = body.nomor ? String(body.nomor).trim() : '';
    const loket = body.loket ? String(body.loket).trim() : '';

    if (!nomor || !loket) {
      return NextResponse.json(
        { success: false, message: 'Nomor antrean dan loket wajib diisi' },
        { status: 400 }
      );
    }

    // Ambil koneksi dari pool
    client = await pool.connect();

    // 1. Simpan riwayat panggilan ke database Neon dengan zona waktu WIB (Asia/Jakarta)
    const queryInsert = `
      INSERT INTO antrean (nomor_antrean, loket, waktu_panggil) 
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      RETURNING id, nomor_antrean, loket, waktu_panggil
    `;

    const resultInsert = await client.query(queryInsert, [nomor, loket]);

    // 2. Kirim sinyal real-time ke Pusher agar layar Kiosk/Display merespons
    await pusher.trigger('antrean-channel', 'event-panggil', {
      id: resultInsert.rows[0]?.id,
      nomor_antrean: nomor,
      loket: loket,
      waktu_panggil: resultInsert.rows[0]?.waktu_panggil,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Antrean berhasil dipanggil',
        data: resultInsert.rows[0],
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error: any) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      console.error('Database Connection Timeout/Error (RSUD Bukit Kerman):', error.message);
    } else {
      console.error('Error API Panggil Antrean:', error);
    }

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal memproses panggilan antrean ke database' 
      },
      { status: 500 }
    );
  } finally {
    // Selalu kembalikan client ke pool agar tidak terjadi leakage koneksi
    if (client) {
      client.release();
    }
  }
}