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
    const loket = body.loket ? String(body.loket).trim() : '';

    if (!loket) {
      return NextResponse.json(
        { success: false, message: 'Nomor loket wajib diisi' },
        { status: 400 }
      );
    }

    // Pemetaan Loket ke Kategori: Loket 1 -> A, Loket 2 -> B, Loket 3 -> C
    const mapKategori: Record<string, string> = {
      '1': 'A',
      '2': 'B',
      '3': 'C',
    };
    const kat = mapKategori[loket] || 'A';

    // Ambil koneksi dari pool
    client = await pool.connect();

    // Mulai Transaksi Database untuk Mencegah Race Condition Antar Loket
    await client.query('BEGIN');

    // 1. Cari antrean terdepan yang belum dipanggil (loket = '0' atau NULL) hari ini (WIB) dengan penguncian baris (FOR UPDATE)
    const querySelect = `
      SELECT id, nomor_antrean 
      FROM antrean 
      WHERE (loket = '0' OR loket IS NULL) 
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date 
        AND UPPER(nomor_antrean) LIKE $1 
      ORDER BY id ASC 
      LIMIT 1
      FOR UPDATE
    `;
    
    const resSelect = await client.query(querySelect, [`${kat}%`]);

    if (resSelect.rows.length === 0) {
      await client.query('COMMIT'); // Commit untuk melepas lock transaksi
      return NextResponse.json(
        {
          success: false,
          message: `Tidak ada antrean menunggu untuk Kategori ${kat} (Loket ${loket})`,
        },
        { status: 404 }
      );
    }

    const antreanNext = resSelect.rows[0];

    // 2. Update status ke nomor loket bersangkutan dan perbarui waktu panggil dalam zona waktu WIB
    const queryUpdate = `
      UPDATE antrean 
      SET loket = $1, waktu_panggil = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta' 
      WHERE id = $2 
      RETURNING id, nomor_antrean, loket, waktu_panggil
    `;
    
    const resUpdate = await client.query(queryUpdate, [loket, antreanNext.id]);

    // Commit transaksi database
    await client.query('COMMIT');

    const dataUpdated = resUpdate.rows[0];

    // 3. Kirim event Pusher real-time ke Display/Kiosk (dibungkus try-catch agar API tidak crash jika Pusher gagal)
    try {
      await pusher.trigger('antrean-channel', 'event-panggil', {
        id: dataUpdated?.id,
        nomor_antrean: antreanNext.nomor_antrean,
        loket: loket,
        waktu_panggil: dataUpdated?.waktu_panggil,
      });
    } catch (pusherErr) {
      console.error('Warning Pusher Trigger Error (Panggil-Next):', pusherErr);
    }

    return NextResponse.json(
      {
        success: true,
        message: `Antrean ${antreanNext.nomor_antrean} berhasil dipanggil ke Loket ${loket}`,
        data: dataUpdated,
        nomor_antrean: antreanNext.nomor_antrean,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error: any) {
    // Rollback transaksi jika terjadi kegagalan agar konsistensi database terjaga
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbError) {
        console.error('Error Rollback Transaksi:', rbError);
      }
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      console.error('Database Connection Timeout/Error (RSUD Bukit Kerman):', error.message);
    } else {
      console.error('Error API Panggil Next:', error);
    }

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal memanggil antrean berikutnya dari database',
        error_detail: error?.message || null,
      },
      { status: 500 }
    );
  } finally {
    // Kembalikan client ke pool
    if (client) {
      client.release();
    }
  }
}