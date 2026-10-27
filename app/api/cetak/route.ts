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
    const kategori = body.kategori || 'A';
    const kat = kategori.toUpperCase().trim();

    // Validasi kategori huruf yang diizinkan (misal: A, B, C, P)
    if (!/^[A-Z]$/.test(kat)) {
      return NextResponse.json(
        { success: false, message: 'Format kategori antrean tidak valid' },
        { status: 400 }
      );
    }

    // Ambil koneksi dari pool
    client = await pool.connect();

    // Memulai Transaksi Database untuk Mencegah Race Condition (Nomor Ganda)
    await client.query('BEGIN');

    // 1. Hitung antrean terakhir hari ini berdasarkan kategori dengan penguncian baris (FOR UPDATE)
    const queryHitung = `
      SELECT nomor_antrean FROM antrean 
      WHERE UPPER(nomor_antrean) LIKE $1 
        AND (waktu_panggil AT TIME ZONE 'Asia/Jakarta')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date 
      ORDER BY id DESC 
      LIMIT 1
      FOR UPDATE
    `;
    
    const resHitung = await client.query(queryHitung, [`${kat}-%`]);

    let nomorUrut = 1;
    if (resHitung.rows.length > 0) {
      const lastNomor = resHitung.rows[0].nomor_antrean;
      const parts = lastNomor.split('-');
      if (parts.length > 1) {
        const angka = parseInt(parts[1], 10);
        if (!isNaN(angka)) {
          nomorUrut = angka + 1;
        }
      }
    }

    // Format nomor antrean: A-001, B-001, C-001
    const nomorTiketBaru = `${kat}-${String(nomorUrut).padStart(3, '0')}`;

    // 2. Simpan tiket baru ke database Neon (loket '0' = belum dipanggil)
    const queryInsert = `
      INSERT INTO antrean (nomor_antrean, loket, waktu_panggil) 
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      RETURNING id, nomor_antrean, waktu_panggil
    `;
    
    const resInsert = await client.query(queryInsert, [nomorTiketBaru, '0']);

    // Commit transaksi jika berhasil
    await client.query('COMMIT');

    return NextResponse.json(
      {
        success: true,
        message: 'Tiket antrean berhasil dicetak',
        data: resInsert.rows[0],
        nomor_antrean: nomorTiketBaru,
        timestamp: new Date().toISOString(),
      },
      { status: 201 }
    );

  } catch (error: any) {
    // Rollback transaksi jika terjadi kegagalan agar database tetap konsisten
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
      console.error('Error API Cetak Tiket:', error);
    }

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal memproses tiket ke database' 
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