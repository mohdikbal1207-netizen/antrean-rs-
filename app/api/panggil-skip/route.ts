import { NextResponse, NextRequest } from 'next/server';
import { Pool } from 'pg';

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

    // Ambil koneksi dari pool
    client = await pool.connect();

    // Query update status loket menjadi 'SKIP' dengan filter zona waktu WIB (Asia/Jakarta)
    const queryUpdate = `
      UPDATE antrean 
      SET loket = 'SKIP', waktu_panggil = CURRENT_TIMESTAMP 
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

    return NextResponse.json(
      {
        success: true,
        message: `Antrean ${nomor} berhasil dilewati (SKIP).`,
        data: result.rows[0],
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
        message: 'Gagal memproses aksi skip antrean ke database' 
      },
      { status: 500 }
    );
  } finally {
    // Selalu kembalikan client ke pool agar tidak terjadi kebocoran koneksi
    if (client) {
      client.release();
    }
  }
}