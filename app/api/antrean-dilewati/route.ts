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

  // Mengambil parameter opsional pada URL (contoh: /api/antrean-dilewati?limit=10&page=1&kategori=A)
  const searchParams = request.nextUrl.searchParams;
  const limitParam = searchParams.get('limit');
  const pageParam = searchParams.get('page');
  const kategoriParam = searchParams.get('kategori'); // Opsional: filter huruf depan (A, B, C, P)

  // Validasi limit (default 50, maksimal 200)
  let limitValue = limitParam ? parseInt(limitParam, 10) : 50;
  if (isNaN(limitValue) || limitValue <= 0) limitValue = 50;
  if (limitValue > 200) limitValue = 200;

  // Validasi page (default halaman 1)
  let pageValue = pageParam ? parseInt(pageParam, 10) : 1;
  if (isNaN(pageValue) || pageValue <= 0) pageValue = 1;

  const offsetValue = (pageValue - 1) * limitValue;

  try {
    // Ambil koneksi dari pool
    client = await pool.connect();

    // Dinamis kondisi WHERE untuk filter kategori
    let kategoriConditionData = '';
    let kategoriConditionCount = '';
    
    const queryParamsData: any[] = [limitValue, offsetValue];
    const queryParamsCount: any[] = [];

    if (kategoriParam && kategoriParam.trim() !== '') {
      // Untuk queryData, parameter limit ($1) dan offset ($2), sehingga kategori menjadi $3
      kategoriConditionData = ` AND UPPER(nomor_antrean) LIKE $3 `;
      queryParamsData.push(`${kategoriParam.toUpperCase()}%`);

      // Untuk queryCount, parameter kategori menjadi $1
      kategoriConditionCount = ` AND UPPER(nomor_antrean) LIKE $1 `;
      queryParamsCount.push(`${kategoriParam.toUpperCase()}%`);
    }

    // Query untuk mengambil data antrean dilewati hari ini
    const queryData = `
      SELECT 
        id, 
        nomor_antrean, 
        waktu_panggil
      FROM antrean 
      WHERE UPPER(loket) = 'SKIP' 
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date 
        ${kategoriConditionData}
      ORDER BY id DESC
      LIMIT $1 OFFSET $2
    `;

    // Query untuk menghitung total keseluruhan baris hari ini
    const queryCount = `
      SELECT COUNT(*) as total_hari_ini
      FROM antrean 
      WHERE UPPER(loket) = 'SKIP' 
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
        ${kategoriConditionCount}
    `;

    // Eksekusi query secara bersamaan (parallel execution) untuk performa optimal
    const [resultData, resultCount] = await Promise.all([
      client.query(queryData, queryParamsData),
      client.query(queryCount, queryParamsCount),
    ]);

    const totalHariIni = parseInt(resultCount.rows[0]?.total_hari_ini || '0', 10);
    const totalPages = Math.ceil(totalHariIni / limitValue) || 1;

    // Kirim respons JSON dengan header anti-caching real-time
    return NextResponse.json(
      {
        success: true,
        pagination: {
          current_page: pageValue,
          per_page: limitValue,
          total_fetched: resultData.rowCount,
          total_today: totalHariIni,
          total_pages: totalPages,
        },
        data: resultData.rows,
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
    // Penanganan error spesifik berdasarkan jenis kegagalan
    if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      console.error('Database Connection Timeout/Error (RSUD Bukit Kerman):', error.message);
    } else {
      console.error('Error API Antrean Dilewati:', error);
    }

    return NextResponse.json(
      {
        success: false,
        message: 'Gagal mengambil data antrean yang dilewati',
        data: [],
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