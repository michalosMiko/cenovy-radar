// CENOVÝ DETEKTOR – AUTOMATIZACE DAT
// - Stabilní aktiva (kurzy ČNB): aktualizace 1x denně (denní spouštěč)
// - Volatilní trhy (20 kryptoměn): aktualizace 4x denně (spouštěč každých 6 hodin)
// - Skript hlídá, kdy je potřeba nový komentář (sloupec N), komentáře píše Claude ráno
// - Chyby se zapisují do listu Log v tabulce

// název listu s daty (když list neexistuje, použije se první list)
const SHEET_NAME = 'List 1';
// název listu, kam se zapisují chyby (vytvoří se sám při první chybě)
const LOG_SHEET_NAME = 'Log';
// číslo sloupce s aktuální cenou (počítáno od 1, sloupec C)
const COL_PRICE = 3;
// číslo sloupce se změnou za den (sloupec D)
const COL_DAY = 4;
// číslo sloupce se změnou za týden (sloupec E)
const COL_WEEK = 5;
// číslo sloupce se změnou za měsíc (sloupec F)
const COL_MONTH = 6;
// číslo sloupce se změnou za rok (sloupec G)
const COL_YEAR = 7;
// číslo sloupce s časem poslední úpravy (sloupec M)
const COL_UPDATED = 13;
// číslo sloupce se znakem, že řádek potřebuje nový komentář (sloupec N: ANO / NE)
const COL_NEED = 14;
// číslo sloupce s cenou v okamžiku posledního komentáře (sloupec O)
const COL_CPRICE = 15;
// číslo sloupce s časem posledního komentáře (sloupec P, formát 2026-10-17T07:00)
const COL_CTIME = 16;
// kolik sloupců skript čte z tabulky (A až P)
const POCET_SLOUPCU = 16;
// při jakém pohybu ceny od posledního komentáře se má psát nový (kryptoměny: 3 %)
const PRAH_KRYPTO = 0.03;
// při jakém pohybu ceny od posledního komentáře se má psát nový (kurzy: 1 %)
const PRAH_KURZ = 0.01;
// nejdéle po kolika dnech se komentář obnoví, i když se cena nehýbe
const MAX_STARI_KOMENTARE_DNI = 3;

// sledované kryptoměny: id řádku v tabulce, název a id na coingecko.com
const KRYPTO = [
  { id: 'btc', nazev: 'Bitcoin (BTC)', cg: 'bitcoin' },
  { id: 'eth', nazev: 'Ethereum (ETH)', cg: 'ethereum' },
  { id: 'bnb', nazev: 'BNB (BNB)', cg: 'binancecoin' },
  { id: 'xrp', nazev: 'XRP (XRP)', cg: 'ripple' },
  { id: 'sol', nazev: 'Solana (SOL)', cg: 'solana' },
  { id: 'trx', nazev: 'TRON (TRX)', cg: 'tron' },
  { id: 'hype', nazev: 'Hyperliquid (HYPE)', cg: 'hyperliquid' },
  { id: 'zec', nazev: 'Zcash (ZEC)', cg: 'zcash' },
  { id: 'doge', nazev: 'Dogecoin (DOGE)', cg: 'dogecoin' },
  { id: 'xmr', nazev: 'Monero (XMR)', cg: 'monero' },
  { id: 'leo', nazev: 'UNUS SED LEO (LEO)', cg: 'leo-token' },
  { id: 'link', nazev: 'Chainlink (LINK)', cg: 'chainlink' },
  { id: 'ada', nazev: 'Cardano (ADA)', cg: 'cardano' },
  { id: 'okb', nazev: 'OKB (OKB)', cg: 'okb' },
  { id: 'near', nazev: 'NEAR Protocol (NEAR)', cg: 'near' },
  { id: 'bch', nazev: 'Bitcoin Cash (BCH)', cg: 'bitcoin-cash' },
  { id: 'xlm', nazev: 'Stellar (XLM)', cg: 'stellar' },
  { id: 'ltc', nazev: 'Litecoin (LTC)', cg: 'litecoin' },
  { id: 'uni', nazev: 'Uniswap (UNI)', cg: 'uniswap' },
  { id: 'avax', nazev: 'Avalanche (AVAX)', cg: 'avalanche-2' },
  { id: 'ton', nazev: 'Toncoin (TON)', cg: 'the-open-network' }
];

// vrátí list s daty, aby se hledání nemuselo opakovat v každé funkci
function ziskejList_() {
  // otevře tabulku, ke které je skript připojený
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // najde list podle názvu, a když neexistuje, vezme první list
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

// zapíše chybu do listu Log, aby šla najít i po běhu přes spouštěč
function zalogujChybu_(kde, err) {
  // zapíše chybu i do protokolu spuštění
  Logger.log(kde + ': ' + err);
  // otevře tabulku, ke které je skript připojený
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // najde list Log, a když neexistuje, vytvoří ho
  const log = ss.getSheetByName(LOG_SHEET_NAME) || ss.insertSheet(LOG_SHEET_NAME);
  // přidá řádek na konec: čas, místo chyby a text chyby
  log.appendRow([new Date(), kde, String(err)]);
}

// stáhne adresu a vrátí text odpovědi; při chybě serveru vyhodí výjimku
function stahni_(url) {
  // stáhne stránku a nespadne při chybovém HTTP kódu, kód zkontrolujeme sami
  const odpoved = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  // zjistí HTTP kód odpovědi (200 = v pořádku)
  const kod = odpoved.getResponseCode();
  // jakýkoliv jiný kód než 200 považuje za chybu a řekne, odkud přišla
  if (kod !== 200) throw new Error('HTTP ' + kod + ' z adresy ' + url);
  // vrátí obsah odpovědi jako text
  return odpoved.getContentText('UTF-8');
}

// doplní hlavičky sloupců N až P a chybějící řádky kryptoměn (jen při prvním spuštění)
function priravRadky_(sheet) {
  // přečte hlavičku sloupců N až P
  const hlavicka = sheet.getRange(1, COL_NEED, 1, 3);
  // když je hlavička prázdná, doplní ji
  if (hlavicka.getValues()[0].join('') === '') hlavicka.setValues([['Potřebuje komentář', 'Cena při komentáři', 'Čas komentáře']]);
  // spočítá datové řádky bez hlavičky
  const pocet = Math.max(sheet.getLastRow() - 1, 0);
  // načte ID, která už v tabulce jsou (sloupec A)
  const existujici = pocet ? sheet.getRange(2, 1, pocet, 1).getValues().map((r) => String(r[0]).trim()) : [];
  // najde řádek Bitcoinu, ze kterého se zkopíruje formát pro nové řádky
  const radekBtc = existujici.indexOf('btc') + 2;
  // projde všechny sledované kryptoměny
  KRYPTO.forEach((k) => {
    // když už řádek v tabulce je, přeskočí ho
    if (existujici.indexOf(k.id) !== -1) return;
    // přidá nový řádek na konec: ID, název a ve sloupci N značku, že chce komentář
    sheet.appendRow([k.id, k.nazev]);
    // zjistí číslo právě přidaného řádku
    const novy = sheet.getLastRow();
    // zkopíruje formát (procenta, čísla) z řádku Bitcoinu, když existuje
    if (radekBtc > 1) sheet.getRange(radekBtc, 1, 1, POCET_SLOUPCU).copyTo(sheet.getRange(novy, 1, 1, POCET_SLOUPCU), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  });
}

// rozhodne, jestli řádek potřebuje nový komentář (velký pohyb ceny nebo starý komentář)
function potrebujeKomentar_(id, radek) {
  // když už je řádek označený, nic dalšího se neřeší
  if (radek[COL_NEED - 1] === 'ANO') return true;
  // cena při posledním komentáři jako číslo (i když by tam byla desetinná čárka)
  const staraCena = parseFloat(String(radek[COL_CPRICE - 1]).replace(',', '.'));
  // čas posledního komentáře
  const casKomentare = new Date(radek[COL_CTIME - 1]);
  // když komentář ještě nikdy nevznikl, je potřeba ho napsat
  if (!staraCena || isNaN(casKomentare.getTime())) return true;
  // zjistí, jestli je to kryptoměna, a podle toho vezme práh pohybu
  const prah = KRYPTO.some((k) => k.id === id) ? PRAH_KRYPTO : PRAH_KURZ;
  // o kolik se cena pohnula od posledního komentáře (zlomek)
  const pohyb = Math.abs(Number(radek[COL_PRICE - 1]) / staraCena - 1);
  // stáří komentáře ve dnech
  const stari = (new Date().getTime() - casKomentare.getTime()) / 86400000;
  // nový komentář je potřeba při velkém pohybu nebo starém komentáři
  return pohyb >= prah || stari >= MAX_STARI_KOMENTARE_DNI;
}

// zapíše nové ceny do tabulky dávkově (2 zápisy místo zápisu po jedné buňce)
// zaznamy = objekt { 'btc': { price: 68450, day: 0.021, week: 0.05, month: 0.1, year: 1.2 } }
// změny jsou zlomky (0,021 = 2,1 %), protože sloupce D až G jsou formátované jako procenta
function zapisCeny_(zaznamy) {
  // vezme list s daty
  const sheet = ziskejList_();
  // doplní hlavičky a chybějící řádky kryptoměn
  priravRadky_(sheet);
  // spočítá datové řádky bez hlavičky
  const pocet = sheet.getLastRow() - 1;
  // když v tabulce nic není, není co zapisovat
  if (pocet < 1) return;
  // načte všechny řádky a sloupce A až P najednou
  const data = sheet.getRange(2, 1, pocet, POCET_SLOUPCU).getValues();
  // připraví aktuální čas v pražském pásmu
  const cas = Utilities.formatDate(new Date(), 'Europe/Prague', 'dd.MM.yyyy HH:mm');
  // zapamatuje si, jestli se vůbec něco změnilo
  let zmeneno = false;
  // projde všechny řádky v paměti (rychlé, nevolá tabulku)
  for (let i = 0; i < pocet; i++) {
    // vezme ID řádku jako text bez mezer
    const id = String(data[i][0]).trim();
    // řádky, které nemáme mezi novými cenami, přeskočí
    if (!(id in zaznamy)) continue;
    // vezme nové hodnoty pro tento řádek
    const z = zaznamy[id];
    // přepíše cenu, když ji máme
    if (z.price !== undefined) data[i][COL_PRICE - 1] = z.price;
    // přepíše změnu za den, když ji máme
    if (z.day !== undefined) data[i][COL_DAY - 1] = z.day;
    // přepíše změnu za týden, když ji máme
    if (z.week !== undefined) data[i][COL_WEEK - 1] = z.week;
    // přepíše změnu za měsíc, když ji máme
    if (z.month !== undefined) data[i][COL_MONTH - 1] = z.month;
    // přepíše změnu za rok, když ji máme
    if (z.year !== undefined) data[i][COL_YEAR - 1] = z.year;
    // přepíše čas poslední úpravy
    data[i][COL_UPDATED - 1] = cas;
    // označí řádek značkou ANO, když potřebuje nový komentář
    if (potrebujeKomentar_(id, data[i])) data[i][COL_NEED - 1] = 'ANO';
    // poznačí, že se má zapisovat
    zmeneno = true;
  }
  // když se nic nezměnilo, nezapisuje nic
  if (!zmeneno) return;
  // zapíše ceny a změny (sloupce C až G) jedním voláním
  sheet.getRange(2, COL_PRICE, pocet, 5).setValues(data.map((r) => r.slice(COL_PRICE - 1, COL_YEAR)));
  // zapíše čas úpravy a značku komentáře (sloupce M až P) jedním voláním
  sheet.getRange(2, COL_UPDATED, pocet, 4).setValues(data.map((r) => r.slice(COL_UPDATED - 1, COL_CTIME)));
}

// vrátí data z tabulky jako JSON (webová aplikace, kterou čte web)
function doGet(e) {
  // vezme list s daty
  const sheet = ziskejList_();
  // načte všechny řádky najednou
  const rows = sheet.getDataRange().getValues();
  // odstraní hlavičku (první řádek)
  rows.shift();
  // připraví prázdný seznam aktiv
  const assets = [];
  // projde všechny řádky tabulky
  rows.forEach((row) => {
    // vezme ID aktiva ze sloupce A
    const id = String(row[0] || '').trim();
    // řádky bez ID přeskočí
    if (!id) return;
    // přidá aktivum do seznamu
    assets.push({
      // ID položky
      id: id,
      // aktuální cena (sloupec C)
      price: parseFloat(row[2]) || 0,
      // změny v čase (sloupce D až G, uložené jako zlomky)
      changes: {
        // změna za den
        day: parseFloat(row[3]) || 0,
        // změna za týden
        week: parseFloat(row[4]) || 0,
        // změna za měsíc
        month: parseFloat(row[5]) || 0,
        // změna za rok
        year: parseFloat(row[6]) || 0
      },
      // štítek (sloupec H)
      actionTag: String(row[7] || '').trim(),
      // rychlý verdikt jednou větou (sloupec I)
      verdict: String(row[8] || '').trim(),
      // co se právě děje (sloupec J)
      what: String(row[9] || '').trim(),
      // hlavní příčina pohybu (sloupec K)
      cause: String(row[10] || '').trim(),
      // dopad na peněženku (sloupec L)
      wallet: String(row[11] || '').trim()
    });
  });
  // sestaví odpověď: čas poslední aktualizace + seznam aktiv
  const payload = {
    // aktuální čas v pražském pásmu
    updatedAt: Utilities.formatDate(new Date(), 'Europe/Prague', 'dd.MM.yyyy HH:mm'),
    // seznam aktiv
    assets: assets
  };
  // vrátí odpověď jako JSON
  return ContentService
    // vytvoří textový výstup z objektu
    .createTextOutput(JSON.stringify(payload))
    // nastaví typ odpovědi na JSON
    .setMimeType(ContentService.MimeType.JSON);
}

// převede procenta z API (2,1) na zlomek (0,021); prázdnou hodnotu vrátí jako undefined
function zlomek_(procenta) {
  // když API hodnotu nevrátilo, nebude se přepisovat
  if (procenta === null || procenta === undefined) return undefined;
  // vydělí 100 a zaokrouhlí na 0,1 %
  return Number((procenta / 100).toFixed(3));
}

/**
 * AKTUALIZACE 4X DENNĚ: kryptoměny (spouští se spouštěčem každých 6 hodin)
 */
function aktualizujVolatilniTrhy() {
  try {
    // vezme bezplatný demo klíč CoinGecko z Vlastností skriptu (klíč není v kódu)
    const klic = PropertiesService.getScriptProperties().getProperty('COINGECKO_KEY');
    // bez klíče nemá smysl pokračovat
    if (!klic) throw new Error('Ve Vlastnostech skriptu chybí COINGECKO_KEY');
    // složí seznam id všech sledovaných mincí oddělených čárkou
    const ids = KRYPTO.map((k) => k.cg).join(',');
    // adresa CoinGecko: cena v USD a změny za 24 h, 7 dní, 30 dní a rok pro všechny mince najednou
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + ids + '&price_change_percentage=24h,7d,30d,1y&per_page=250';
    // stáhne odpověď a pošle klíč v hlavičce
    const odpoved = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'x-cg-demo-api-key': klic } });
    // jakýkoliv jiný kód než 200 je chyba
    if (odpoved.getResponseCode() !== 200) throw new Error('HTTP ' + odpoved.getResponseCode() + ' z CoinGecko');
    // převede odpověď z textu na pole mincí
    const pole = JSON.parse(odpoved.getContentText('UTF-8'));
    // sem se uloží výsledky podle ID řádku v tabulce
    const zaznamy = {};
    // projde všechny sledované mince
    KRYPTO.forEach((k) => {
      // najde minci v odpovědi podle id na CoinGecko
      const c = pole.filter((x) => x.id === k.cg)[0];
      // když ji CoinGecko nevrátil, zapíše chybu a pokračuje další mincí
      if (!c) { zalogujChybu_('aktualizujVolatilniTrhy ' + k.id, new Error('CoinGecko nevrátil ' + k.cg)); return; }
      // uloží cenu a změny jako zlomky
      zaznamy[k.id] = { price: c.current_price, day: zlomek_(c.price_change_percentage_24h_in_currency), week: zlomek_(c.price_change_percentage_7d_in_currency), month: zlomek_(c.price_change_percentage_30d_in_currency), year: zlomek_(c.price_change_percentage_1y_in_currency) };
    });
    // zapíše všechno do tabulky najednou
    zapisCeny_(zaznamy);
  } catch (err) {
    // chybu uloží do listu Log
    zalogujChybu_('aktualizujVolatilniTrhy', err);
  }
}

/**
 * AKTUALIZACE 1X DENNĚ: kurzy ČNB (spouští se denním spouštěčem)
 */
function aktualizujStabilniMakrodata() {
  try {
    // adresa denního kurzovního lístku ČNB v textovém formátu
    const url = 'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt';
    // stáhne soubor a rozdělí ho na řádky
    const radky = stahni_(url).split('\n');
    // sem se uloží nalezené kurzy podle ID řádku v tabulce
    const kurzy = {};
    // projde všechny řádky souboru
    radky.forEach((radek) => {
      // rozdělí řádek podle svislítka (země|měna|množství|kód|kurz)
      const casti = radek.split('|');
      // řádky s menším počtem částí (hlavičky) přeskočí
      if (casti.length < 5) return;
      // kód měny je ve čtvrté části
      const kod = casti[3].trim();
      // kurz je v páté části, desetinnou čárku změní na tečku
      const kurz = parseFloat(casti[4].trim().replace(',', '.'));
      // když je to EUR a kurz je číslo, uloží ho pro řádek eur-czk
      if (kod === 'EUR' && kurz) kurzy['eur-czk'] = { price: kurz };
      // když je to USD a kurz je číslo, uloží ho pro řádek usd-czk
      if (kod === 'USD' && kurz) kurzy['usd-czk'] = { price: kurz };
    });
    // když se nenašel žádný kurz, je to chyba (změnil se formát souboru)
    if (Object.keys(kurzy).length === 0) throw new Error('V souboru ČNB nebyl kurz EUR ani USD');
    // zapíše nové kurzy do tabulky (změny za den až rok tu nepřepisujeme)
    zapisCeny_(kurzy);
  } catch (err) {
    // chybu uloží do listu Log
    zalogujChybu_('aktualizujStabilniMakrodata', err);
  }
}
