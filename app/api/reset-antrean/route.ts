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

export async function POST(request: NextRequest) {
  let client;

  try {
    // Ambil koneksi dari pool
    client = await pool.connect();

    // Query penghapusan data antrean hari ini berdasarkan Zona Waktu WIB (Asia/Jakarta)
    const queryDelete = `
      DELETE FROM antrean 
      WHERE (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
    `;

    const result = await client.query(queryDelete);

    return NextResponse.json(
      {
        success: true,
        message: 'Seluruh data antrean hari ini berhasil direset.',
        deleted_count: result.rowCount,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error: any) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      console.error('Database Connection Timeout/Error (RSUD Bukit Kerman):', error.message);
    } else {
      console.error('Error API Reset Antrean:', error);
    }

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal mereset data antrean dari database' 
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