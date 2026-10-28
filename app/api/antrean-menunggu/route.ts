import { NextResponse, NextRequest } from 'next/server';
import { connection } from 'next/server';
import { Pool } from 'pg';

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
  await connection();

  let client;

  const searchParams = request.nextUrl.searchParams;
  const limitParam = searchParams.get('limit');
  const pageParam = searchParams.get('page');
  const kategoriParam = searchParams.get('kategori');

  let limitValue = limitParam ? parseInt(limitParam, 10) : 50;
  if (isNaN(limitValue) || limitValue <= 0) limitValue = 50;
  if (limitValue > 200) limitValue = 200;

  let pageValue = pageParam ? parseInt(pageParam, 10) : 1;
  if (isNaN(pageValue) || pageValue <= 0) pageValue = 1;

  const offsetValue = (pageValue - 1) * limitValue;

  try {
    client = await pool.connect();

    // 🔄 AUTO-RESET OTOMATIS: 
    // Menghapus data antrean dari hari sebelumnya berdasarkan tanggal pada waktu_panggil (WIB)
    await client.query(`
      DELETE FROM antrean 
      WHERE (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
    `);

    let kategoriConditionData = '';
    let kategoriConditionCount = '';
    
    const queryParamsData: any[] = [limitValue, offsetValue];
    const queryParamsCount: any[] = [];

    if (kategoriParam && kategoriParam.trim() !== '') {
      kategoriConditionData = ` AND UPPER(nomor_antrean) LIKE $3 `;
      queryParamsData.push(`${kategoriParam.toUpperCase()}%`);

      kategoriConditionCount = ` AND UPPER(nomor_antrean) LIKE $1 `;
      queryParamsCount.push(`${kategoriParam.toUpperCase()}%`);
    }

    // Query antrean MENUNGGU (Hanya memfilter tanggal hari ini dari waktu_panggil)
    const queryData = `
      SELECT 
        id, 
        nomor_antrean, 
        loket,
        waktu_panggil
      FROM antrean 
      WHERE (loket = '0' OR loket IS NULL OR UPPER(loket) != 'SKIP')
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
        ${kategoriConditionData}
      ORDER BY id ASC
      LIMIT $1 OFFSET $2
    `;

    const queryCount = `
      SELECT COUNT(*) as total_hari_ini
      FROM antrean 
      WHERE (loket = '0' OR loket IS NULL OR UPPER(loket) != 'SKIP')
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
        ${kategoriConditionCount}
    `;

    const [resultData, resultCount] = await Promise.all([
      client.query(queryData, queryParamsData),
      client.query(queryCount, queryParamsCount),
    ]);

    const totalHariIni = parseInt(resultCount.rows[0]?.total_hari_ini || '0', 10);
    const totalPages = Math.ceil(totalHariIni / limitValue) || 1;

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
    console.error('Error API Antrean Menunggu:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Gagal mengambil data antrean menunggu',
        error_detail: error?.message || null,
        data: [],
      },
      { status: 500 }
    );
  } finally {
    if (client) {
      client.release();
    }
  }
}