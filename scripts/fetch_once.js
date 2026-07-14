// scripts/fetch_once.js — 手動抓一段區間：node scripts/fetch_once.js <source> <from> <to>
// source: ga | fb_page | ads | all
require('dotenv').config();
const { pool } = require('../lib/db');
const { taipeiToday, addDays } = require('../lib/dates');

async function main() {
  const [source = 'all', from = addDays(taipeiToday(), -3), to = addDays(taipeiToday(), -1)] =
    process.argv.slice(2);
  const fetchers = {};
  try { fetchers.ga = require('../fetchers/ga').fetchGa; } catch (_) {}
  try { fetchers.fb_page = require('../fetchers/fb_page').fetchFbPage; } catch (_) {}
  try { fetchers.ads = require('../fetchers/ads').fetchAds; } catch (_) {}

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
