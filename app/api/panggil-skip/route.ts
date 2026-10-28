import { NextResponse, NextRequest } from 'next/server';
import { Pool } from 'pg';
import Pusher from 'pusher';

// Mencegah pembuatan pool baru secara berulang saat Next.js hot-reload di mode development
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
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
  useTLS: true,
});

export async function POST(req: NextRequest) {
  let client;

  try {
    const body = await req.json().catch(() => ({}));
    const nomor = body.nomor ? String(body.nomor).trim().toUpperCase() : '';

    if (!nomor) {
      return NextResponse.json(
        { success: false, message: 'Nomor antrean wajib diisi' },
        { status: 400 }
      );
    }

    client = await pool.connect();

    // Query update status loket menjadi 'SKIP' dengan penetapan zona waktu WIB
    const queryUpdate = `
      UPDATE antrean 
      SET loket = 'SKIP', waktu_panggil = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta' 
      WHERE UPPER(nomor_antrean) = $1 
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
      RETURNING id, nomor_antrean, loket, waktu_panggil
    `;

    const result = await client.query(queryUpdate, [nomor]);

    // Jika nomor antrean tidak ditemukan pada hari ini
    if (result.rowCount === 0) {
      return NextResponse.json(
        { 
          success: false, 
          message: `Nomor antrean ${nomor} tidak ditemukan dalam data aktif hari ini` 
        },
        { status: 404 }
      );
    }

    const dataSkip = result.rows[0];

    // Kirim event Pusher real-time ke Display/Kiosk
    try {
      await pusher.trigger('antrean-channel', 'event-skip', {
        id: dataSkip.id,
        nomor_antrean: dataSkip.nomor_antrean,
        loket: 'SKIP',
        waktu_panggil: dataSkip.waktu_panggil,
      });
    } catch (pusherErr) {
      console.error('Warning Pusher Trigger Error (Panggil-Skip):', pusherErr);
    }

    return NextResponse.json(
      {
        success: true,
        message: `Antrean ${nomor} berhasil dilewati (SKIP).`,
        data: dataSkip,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error: any) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      console.error('Database Connection Timeout/Error (RSUD Bukit Kerman):', error.message);
    } else {
      console.error('Error API Skip Antrean:', error);
    }

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal memproses aksi skip antrean ke database',
        error_detail: error?.message || null,
      },
      { status: 500 }
    );
  } finally {
    if (client) {
      client.release();
    }
  }
}