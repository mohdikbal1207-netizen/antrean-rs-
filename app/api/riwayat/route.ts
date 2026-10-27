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

export async function GET(request: NextRequest) {
  let client;

  // Ambil parameter opsional limit pada URL (default 5 riwayat terakhir)
  const searchParams = request.nextUrl.searchParams;
  const limitParam = searchParams.get('limit');
  let limitValue = limitParam ? parseInt(limitParam, 10) : 5;
  if (isNaN(limitValue) || limitValue <= 0) limitValue = 5;
  if (limitValue > 20) limitValue = 20;

  try {
    // Ambil koneksi dari pool
    client = await pool.connect();

    // Query untuk mengambil riwayat panggilan hari ini (WIB) yang sudah dipanggil (loket != '0')
    const queryText = `
      SELECT 
        id,
        nomor_antrean AS nomor, 
        loket,
        waktu_panggil
      FROM antrean 
      WHERE UPPER(loket) != '0' 
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date 
      ORDER BY id DESC 
      LIMIT $1
    `;

    const result = await client.query(queryText, [limitValue]);

    // Kirim respons JSON dengan header anti-caching real-time
    return NextResponse.json(
      {
        success: true,
        total: result.rowCount,
        data: result.rows,
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );

  } catch (error: any) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      console.error('Database Connection Timeout/Error (RSUD Bukit Kerman):', error.message);
    } else {
      console.error('Error API Riwayat Antrean:', error);
    }

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal memuat riwayat antrean dari database',
        data: [] 
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