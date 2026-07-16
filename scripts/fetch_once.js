// scripts/fetch_once.js — 手動抓一段區間：node scripts/fetch_once.js <source> <from> <to>
// source: ga | fb_page | ads | all
require('dotenv').config();
const { pool } = require('../lib/db');
const { taipeiToday, addDays } = require('../lib/dates');

function tryRequire(path) {
  try { return require(path); }
  catch (e) { if (e.code === 'MODULE_NOT_FOUND') return null; throw e; }
}

async function main() {
  const [source = 'all', from = addDays(taipeiToday(), -3), to = addDays(taipeiToday(), -1)] =
    process.argv.slice(2);
  const fetchers = {};
  fetchers.ga = tryRequire('../fetchers/ga')?.fetchGa;
  fetchers.fb_page = tryRequire('../fetchers/fb_page')?.fetchFbPage;
  fetchers.ads = tryRequire('../fetchers/ads')?.fetchAds;

  const targets = source === 'all' ? Object.keys(fetchers) : [source];
  for (const name of targets) {
    if (!fetchers[name]) { console.log(`(略過 ${name}：模組不存在)`); continue; }
    console.log(`== ${name} ${from} ~ ${to} ==`);
    try {
      console.log(await fetchers[name](pool, from, to));
    } catch (err) {
      console.error(`${name} 失敗:`, err.message);
    }
  }
  await pool.end();
}
main();
