// Teste de conectividade com o Oracle (TOTVS RM).
// Uso: npx tsx scripts/test-oracle.ts
import 'dotenv/config'
import oracledb from 'oracledb'

async function main() {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_DBPRD_USER,
    password: process.env.ORACLE_DBPRD_PASSWORD,
    connectString: process.env.ORACLE_DBPRD_CONNECT_STRING,
  })
  const result = await conn.execute(
    'SELECT COUNT(*) N FROM RM.TTRA WHERE CODCOLIGADA IN (2,3,5,6,28,33,34)',
  )
  console.log('Conectado. Transportadoras:', JSON.stringify(result.rows))
  await conn.close()
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  process.exit(1)
})
