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

export async function POST(req: NextRequest) {
  let client;

  try {
    const body = await req.json().catch(() => ({}));
    const kategori = body.kategori || 'A';
    const kat = kategori.toUpperCase().trim();

    if (!/^[A-Z]$/.test(kat)) {
      return NextResponse.json(
        { success: false, message: 'Format kategori antrean tidak valid' },
        { status: 400 }
      );
    }

    client = await pool.connect();

    // Memulai Transaksi Database untuk Mencegah Race Condition (Nomor Ganda)
    await client.query('BEGIN');

    // 1. Hitung antrean terakhir HARI INI berdasarkan kategori (Menggunakan waktu_panggil)
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

    const nomorTiketBaru = `${kat}-${String(nomorUrut).padStart(3, '0')}`;

    // 2. Simpan tiket baru ke database Neon 
    // loket '0' = MENUNGGU, waktu_panggil dipaksa ke WIB agar filter tanggalnya sinkron
    const queryInsert = `
      INSERT INTO antrean (nomor_antrean, loket, waktu_panggil) 
      VALUES ($1, '0', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
      RETURNING id, nomor_antrean, loket, waktu_panggil
    `;
    
    const resInsert = await client.query(queryInsert, [nomorTiketBaru]);

    // Commit transaksi jika semua sukses
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
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbError) {
        console.error('Error Rollback Transaksi:', rbError);
      }
    }

    console.error('CRITICAL ERROR API CETAK KIOSK:', error);

    return NextResponse.json(
      { 
        success: false, 
        message: 'Gagal memproses tiket ke database',
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