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

  try {
    // Ambil koneksi dari pool
    client = await pool.connect();

    // Filter tanggal harian berbasis Zona Waktu WIB (Asia/Jakarta)
    const dateFilter = `(waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date`;

    // Query terpisah untuk total, terlayani, sisa (menunggu), dilewati (skip), dan per loket
    const queryTotal = `SELECT COUNT(*) as count FROM antrean WHERE ${dateFilter}`;
    const queryTerlayani = `SELECT COUNT(*) as count FROM antrean WHERE ${dateFilter} AND UPPER(loket) != '0' AND UPPER(loket) != 'SKIP'`;
    const querySisa = `SELECT COUNT(*) as count FROM antrean WHERE ${dateFilter} AND UPPER(loket) = '0'`;
    const queryDilewati = `SELECT COUNT(*) as count FROM antrean WHERE ${dateFilter} AND UPPER(loket) = 'SKIP'`;
    
    const queryPerLoket = `
      SELECT loket, COUNT(*) as jumlah 
      FROM antrean 
      WHERE ${dateFilter} AND UPPER(loket) != '0' AND UPPER(loket) != 'SKIP' 
      GROUP BY loket 
      ORDER BY loket ASC
    `;

    // Eksekusi seluruh query secara paralel (Promise.all) untuk performa optimal
    const [resTotal, resTerlayani, resSisa, resDilewati, resPerLoket] = await Promise.all([
      client.query(queryTotal),
      client.query(queryTerlayani),
      client.query(querySisa),
      client.query(queryDilewati),
      client.query(queryPerLoket),
    ]);

    // Kirim respons JSON dengan header anti-caching real-time
    return NextResponse.json(
      {
        success: true,
        data: {
          total: parseInt(resTotal.rows[0]?.count || '0', 10),
          terlayani: parseInt(resTerlayani.rows[0]?.count || '0', 10),
          sisa: parseInt(resSisa.rows[0]?.count || '0', 10),
          dilewati: parseInt(resDilewati.rows[0]?.count || '0', 10), // Metrik baru: jumlah pasien skip
          detailLoket: resPerLoket.rows,
        },
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
      console.error('Error API Laporan Antrean:', error);
    }

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal memuat laporan antrean dari database' 
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