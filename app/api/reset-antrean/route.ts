import { NextResponse, NextRequest } from 'next/server';
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

export async function POST(request: NextRequest) {
  let client;

  try {
    client = await pool.connect();

    // Karena struktur tabel 4 kolom, reset harian membersihkan seluruh isi tabel antrean
    const queryDelete = `DELETE FROM antrean`;
    const result = await client.query(queryDelete);

    return NextResponse.json(
      {
        success: true,
        message: 'Seluruh data antrean berhasil direset.',
        deleted_count: result.rowCount,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('Error API Reset Antrean:', error);

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal mereset data antrean dari database',
        error_detail: error?.message || null
      },
      { status: 500 }
    );
  } finally {
    if (client) {
      client.release();
    }
  }
}