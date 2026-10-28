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
    const loket = body.loket ? String(body.loket).trim() : '';

    if (!nomor || !loket) {
      return NextResponse.json(
        { success: false, message: 'Nomor antrean dan loket wajib diisi' },
        { status: 400 }
      );
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Cek apakah nomor antrean sudah dicetak hari ini
    const queryCheck = `
      SELECT id FROM antrean
      WHERE UPPER(nomor_antrean) = UPPER($1)
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
      LIMIT 1
      FOR UPDATE
    `;
    const resCheck = await client.query(queryCheck, [nomor]);

    let dataAntrean;

    if (resCheck.rows.length > 0) {
      // Update status loket antrean yang ada
      const queryUpdate = `
        UPDATE antrean
        SET loket = $1, waktu_panggil = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta'
        WHERE id = $2
        RETURNING id, nomor_antrean, loket, waktu_panggil
      `;
      const resUpdate = await client.query(queryUpdate, [loket, resCheck.rows[0].id]);
      dataAntrean = resUpdate.rows[0];
    } else {
      // Buat entri antrean baru jika belum ada
      const queryInsert = `
        INSERT INTO antrean (nomor_antrean, loket, waktu_panggil)
        VALUES ($1, $2, CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
        RETURNING id, nomor_antrean, loket, waktu_panggil
      `;
      const resInsert = await client.query(queryInsert, [nomor, loket]);
      dataAntrean = resInsert.rows[0];
    }

    await client.query('COMMIT');

    // 2. Trigger event real-time Pusher
    try {
      await pusher.trigger('antrean-channel', 'event-panggil', {
        id: dataAntrean.id,
        nomor_antrean: dataAntrean.nomor_antrean,
        loket: dataAntrean.loket,
        waktu_panggil: dataAntrean.waktu_panggil,
      });
    } catch (pusherErr) {
      console.error('Warning Pusher Trigger Error:', pusherErr);
    }

    return NextResponse.json(
      {
        success: true,
        message: `Antrean ${dataAntrean.nomor_antrean} berhasil dipanggil ke Loket ${loket}`,
        data: dataAntrean,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error: any) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback Error:', rbErr);
      }
    }

    console.error('Error API Panggil Antrean:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Gagal memproses panggilan antrean ke database',
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