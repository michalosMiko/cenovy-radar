// CENOVÝ DETEKTOR – AUTOMATIZACE DAT
// - Stabilní aktiva (kurzy ČNB): aktualizace 1x denně (denní spouštěč)
// - Volatilní trhy (krypto): aktualizace 4x denně (spouštěč každých 6 hodin)
// - Chyby se zapisují do listu Log v tabulce

// název listu s daty (když list neexistuje, použije se první list)
const SHEET_NAME = 'List 1';
// název listu, kam se zapisují chyby (vytvoří se sám při první chybě)
const LOG_SHEET_NAME = 'Log';
// číslo sloupce s aktuální cenou (počítáno od 1, sloupec C)
const COL_PRICE = 3;
// číslo sloupce se změnou za den (sloupec D)
const COL_DAY = 4;
// číslo sloupce s časem poslední úpravy (sloupec M)
const COL_UPDATED = 13;

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

// zapíše nové ceny do tabulky dávkově (3 zápisy místo zápisu po jedné buňce)
// ceny = objekt { 'btc': 68450 }, kde klíč je ID položky ze sloupce A
// zmenyDne = objekt { 'btc': 0.021 }, zlomek (0,021 = 2,1 %), protože sloupec D je formátovaný jako procenta
function zapisCeny_(ceny, zmenyDne) {
  // vezme list s daty
  const sheet = ziskejList_();
  // spočítá datové řádky bez hlavičky
  const pocet = sheet.getLastRow() - 1;
  // když v tabulce nic není, není co zapisovat
  if (pocet < 1) return;
  // načte sloupec s ID položek (jedno volání pro všechny řádky)
  const ids = sheet.getRange(2, 1, pocet, 1).getValues();
  // načte sloupec s cenami
  const sloupecCen = sheet.getRange(2, COL_PRICE, pocet, 1).getValues();
  // načte sloupec se změnami za den
  const sloupecZmen = sheet.getRange(2, COL_DAY, pocet, 1).getValues();
  // načte sloupec s časem poslední úpravy
  const sloupecCasu = sheet.getRange(2, COL_UPDATED, pocet, 1).getValues();
  // připraví aktuální čas v pražském pásmu
  const cas = Utilities.formatDate(new Date(), 'Europe/Prague', 'dd.MM.yyyy HH:mm');
  // zapamatuje si, jestli se vůbec něco změnilo
  let zmeneno = false;
  // projde všechny řádky v paměti (rychlé, nevolá tabulku)
  for (let i = 0; i < pocet; i++) {
    // vezme ID řádku jako text bez mezer
    const id = String(ids[i][0]).trim();
    // řádky, které nemáme mezi novými cenami, přeskočí
    if (!(id in ceny)) continue;
    // přepíše cenu v paměti
    sloupecCen[i][0] = ceny[id];
    // když máme i změnu za den, přepíše ji v paměti
    if (id in zmenyDne) sloupecZmen[i][0] = zmenyDne[id];
    // přepíše čas poslední úpravy
    sloupecCasu[i][0] = cas;
    // poznačí, že se má zapisovat
    zmeneno = true;
  }
  // když se nic nezměnilo, nezapisuje nic
  if (!zmeneno) return;
  // zapíše celý sloupec cen jedním voláním
  sheet.getRange(2, COL_PRICE, pocet, 1).setValues(sloupecCen);
  // zapíše celý sloupec změn jedním voláním
  sheet.getRange(2, COL_DAY, pocet, 1).setValues(sloupecZmen);
  // zapíše celý sloupec časů jedním voláním
  sheet.getRange(2, COL_UPDATED, pocet, 1).setValues(sloupecCasu);
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

/**
 * AKTUALIZACE 4X DENNĚ: kryptoměny (spouští se spouštěčem každých 6 hodin)
 */
function aktualizujVolatilniTrhy() {
  try {
    // adresa CoinGecko API: cena Bitcoinu v USD a změna za 24 hodin
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true';
    // stáhne odpověď a převede ji z textu na objekt
    const result = JSON.parse(stahni_(url));
    // když odpověď neobsahuje Bitcoin, je to chyba
    if (!result || !result.bitcoin) throw new Error('CoinGecko nevrátil data o Bitcoinu');
    // převede změnu z procent na zlomek (2,1 % → 0,021) a zaokrouhlí na 0,1 %
    const zmena = Number((result.bitcoin.usd_24h_change / 100).toFixed(3));
    // zapíše cenu a změnu do řádku s ID btc
    zapisCeny_({ 'btc': result.bitcoin.usd }, { 'btc': zmena });
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
      if (kod === 'EUR' && kurz) kurzy['eur-czk'] = kurz;
      // když je to USD a kurz je číslo, uloží ho pro řádek usd-czk
      if (kod === 'USD' && kurz) kurzy['usd-czk'] = kurz;
    });
    // když se nenašel žádný kurz, je to chyba (změnil se formát souboru)
    if (Object.keys(kurzy).length === 0) throw new Error('V souboru ČNB nebyl kurz EUR ani USD');
    // zapíše nové kurzy do tabulky (změnu za den tu nepřepisujeme)
    zapisCeny_(kurzy, {});
  } catch (err) {
    // chybu uloží do listu Log
    zalogujChybu_('aktualizujStabilniMakrodata', err);
  }
}
