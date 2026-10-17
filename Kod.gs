// CENOVÝ DETEKTOR – AUTOMATIZACE DAT
// - Stabilní aktiva (kurzy ČNB): aktualizace 1x denně (denní spouštěč)
// - Volatilní trhy (20 kryptoměn): aktualizace 4x denně (spouštěč každých 6 hodin)
// - Skript hlídá, kdy je potřeba nový komentář (sloupec N), komentáře píše Claude ráno
// - Chyby se zapisují do listu Log v tabulce

// název listu s daty (když list neexistuje, použije se první list)
const SHEET_NAME = 'List 1';
// název listu, kam se zapisují chyby (vytvoří se sám při první chybě)
const LOG_SHEET_NAME = 'Log';
// název listu s denními snímky cen (sloupce: id, datum, cena; vytvoří se sám)
const HISTORIE_SHEET_NAME = 'Historie';
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

// vrátí list Historie; když neexistuje, vytvoří ho i s hlavičkou
function ziskejHistoriiList_() {
  // otevře tabulku, ke které je skript připojený
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // zkusí najít existující list Historie
  let list = ss.getSheetByName(HISTORIE_SHEET_NAME);
  // když list ještě není, vytvoří ho
  if (!list) {
    // vytvoří nový list na konci
    list = ss.insertSheet(HISTORIE_SHEET_NAME);
    // zapíše hlavičku sloupců
    list.getRange(1, 1, 1, 3).setValues([['id', 'datum', 'cena']]);
    // sloupec s datem nastaví jako prostý text, aby ho Tabulky nepřevedly na datum
    list.getRange('B:B').setNumberFormat('@');
    // ukotví první řádek s hlavičkou
    list.setFrozenRows(1);
  }
  // vrátí list
  return list;
}

// převede hodnotu z buňky (text nebo datum) na text ve tvaru rrrr-mm-dd
function datumText_(hodnota) {
  // když Tabulky hodnotu přece jen převedly na datum, naformátuje ho zpět na text
  if (hodnota instanceof Date) return Utilities.formatDate(hodnota, 'Europe/Prague', 'yyyy-MM-dd');
  // jinak vezme text bez mezer
  return String(hodnota).trim();
}

// vrátí datum před zadaným počtem dní jako text rrrr-mm-dd (pražský čas)
function datumPred_(dnu) {
  // od aktuálního času odečte dny a naformátuje
  return Utilities.formatDate(new Date(new Date().getTime() - dnu * 86400000), 'Europe/Prague', 'yyyy-MM-dd');
}

// zapíše řádky [id, datum, cena] do listu Historie dávkově
// prepsat = true: když už existuje řádek pro stejné id a datum, přepíše jeho cenu (denní snímek)
// prepsat = false: existující řádky nechá být a přidá jen nové (zpětné doplnění)
function zapisDoHistorie_(radky, prepsat) {
  // když není co zapisovat, skončí
  if (!radky.length) return;
  // vezme list Historie
  const list = ziskejHistoriiList_();
  // spočítá už zapsané řádky bez hlavičky
  const pocet = Math.max(list.getLastRow() - 1, 0);
  // načte všechny existující řádky najednou
  const existujici = pocet ? list.getRange(2, 1, pocet, 3).getValues() : [];
  // postaví si mapu klíč (id|datum) -> pořadí řádku v paměti
  const mapa = {};
  // projde existující řádky
  existujici.forEach((r, i) => { mapa[String(r[0]).trim() + '|' + datumText_(r[1])] = i; });
  // sem se naskládají řádky, které v listu ještě nejsou
  const nove = [];
  // pamatuje si, jestli se přepsala některá stará cena
  let prepsano = false;
  // projde všechny řádky určené k zápisu
  radky.forEach((r) => {
    // klíč řádku je id a datum
    const klic = r[0] + '|' + r[1];
    // když už v listu je
    if (klic in mapa) {
      // při přepisu změní cenu v paměti (jen u řádků, které už jsou v listu)
      if (prepsat && mapa[klic] >= 0 && mapa[klic] < existujici.length) { existujici[mapa[klic]][2] = r[2]; prepsano = true; }
      // jinak řádek přeskočí
      return;
    }
    // označí klíč jako zapsaný, aby se v jedné dávce nepřidal dvakrát (-1 = nový řádek)
    mapa[klic] = -1;
    // přidá řádek mezi nové
    nove.push([r[0], r[1], r[2]]);
  });
  // když se přepisovaly ceny, zapíše celý sloupec C zpět jedním voláním
  if (prepsano) list.getRange(2, 3, pocet, 1).setValues(existujici.map((r) => [r[2]]));
  // nové řádky přidá na konec jedním voláním
  if (nove.length) list.getRange(list.getLastRow() + 1, 1, nove.length, 3).setValues(nove);
}

// uloží denní snímek: aktuální ceny všech aktiv z listu s daty do listu Historie
function ulozSnimekHistorie_() {
  // vezme list s daty
  const sheet = ziskejList_();
  // spočítá datové řádky bez hlavičky
  const pocet = sheet.getLastRow() - 1;
  // když v tabulce nic není, skončí
  if (pocet < 1) return;
  // načte sloupce A až C (id, název, cena)
  const data = sheet.getRange(2, 1, pocet, 3).getValues();
  // dnešní datum jako text
  const dnes = datumPred_(0);
  // sem se naskládají řádky snímku
  const radky = [];
  // projde všechny řádky tabulky
  data.forEach((r) => {
    // ID aktiva bez mezer
    const id = String(r[0]).trim();
    // cena jako číslo (prázdná buňka dá 0)
    const cena = Number(r[2]);
    // přidá jen řádky s ID a kladnou cenou
    if (id && cena > 0) radky.push([id, dnes, cena]);
  });
  // zapíše snímek a při opakovaném běhu ve stejný den přepíše dnešní cenu
  zapisDoHistorie_(radky, true);
}

// načte celou Historii do paměti jako objekt { id: [ {d: 'rrrr-mm-dd', p: cena}, ... ] } seřazený od nejstaršího
function nactiHistoriiMapu_() {
  // vezme list Historie
  const list = ziskejHistoriiList_();
  // spočítá řádky bez hlavičky
  const pocet = Math.max(list.getLastRow() - 1, 0);
  // načte všechny řádky najednou
  const data = pocet ? list.getRange(2, 1, pocet, 3).getValues() : [];
  // výsledná mapa
  const mapa = {};
  // projde všechny řádky
  data.forEach((r) => {
    // ID bez mezer
    const id = String(r[0]).trim();
    // cena jako číslo
    const cena = Number(r[2]);
    // prázdné nebo vadné řádky přeskočí
    if (!id || !(cena > 0)) return;
    // pro nové ID založí pole
    if (!mapa[id]) mapa[id] = [];
    // přidá bod do řady
    mapa[id].push({ d: datumText_(r[1]), p: cena });
  });
  // seřadí každou řadu podle data (text rrrr-mm-dd se řadí správně i jako text)
  Object.keys(mapa).forEach((id) => mapa[id].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)));
  // vrátí mapu
  return mapa;
}

// vrátí cenu z doby před zadaným počtem dní (poslední známou k tomu dni), nebo undefined když historie nestačí
function cenaPredDny_(rada, dnu) {
  // bez řady nebo bez bodů nemáme nic
  if (!rada || !rada.length) return undefined;
  // cílové datum
  const cil = datumPred_(dnu);
  // nejstarší záznam je novější než cíl: historie ještě nesahá tak daleko
  if (rada[0].d > cil) return undefined;
  // nejstarší datum, které ještě přijmeme (tolerance 7 dní kvůli víkendům a svátkům)
  const nejdriv = datumPred_(dnu + 7);
  // prochází řadu od konce a hledá poslední záznam k cílovému dni
  for (let i = rada.length - 1; i >= 0; i--) {
    // záznam je dost starý, tak ho vezme, ale jen když není moc starý
    if (rada[i].d <= cil) return rada[i].d >= nejdriv ? rada[i].p : undefined;
  }
  // nic nenalezeno
  return undefined;
}

// doplní do záznamů změny za den, týden, měsíc a rok spočítané z Historie (jen tam, kde je zdroj sám nedodal)
function doplnZmeny_(zaznamy) {
  // načte historii jednou pro všechna aktiva
  const historie = nactiHistoriiMapu_();
  // dvojice název pole a počet dní zpět
  const okna = [['day', 1], ['week', 7], ['month', 30], ['year', 365]];
  // projde všechna aktiva v záznamech
  Object.keys(zaznamy).forEach((id) => {
    // záznam aktiva
    const z = zaznamy[id];
    // bez aktuální ceny nemá smysl počítat
    if (!(z.price > 0)) return;
    // projde všechna časová okna
    okna.forEach((o) => {
      // když zdroj změnu dodal, nechá ji být
      if (z[o[0]] !== undefined) return;
      // najde cenu z dřívější doby
      const stara = cenaPredDny_(historie[id], o[1]);
      // když ji máme, spočítá změnu jako zlomek (0,021 = 2,1 %)
      if (stara) z[o[0]] = Number((z.price / stara - 1).toFixed(3));
    });
  });
}

// vrátí historii jako JSON { updatedAt, history: { id: [[datum, cena], ...] } }, volitelně jen pro jedno id
function historieJson_(idFiltr) {
  // načte historii do paměti
  const mapa = nactiHistoriiMapu_();
  // sem se uloží výstup ve zhuštěném tvaru
  const vystup = {};
  // projde všechna ID
  Object.keys(mapa).forEach((id) => {
    // když web chce jedno ID, ostatní přeskočí
    if (idFiltr && id !== idFiltr) return;
    // převede body na dvojice [datum, cena]
    vystup[id] = mapa[id].map((b) => [b.d, b.p]);
  });
  // vrátí odpověď jako JSON
  return ContentService
    // vytvoří textový výstup z objektu
    .createTextOutput(JSON.stringify({ updatedAt: Utilities.formatDate(new Date(), 'Europe/Prague', 'dd.MM.yyyy HH:mm'), history: vystup }))
    // nastaví typ odpovědi na JSON
    .setMimeType(ContentService.MimeType.JSON);
}

// vrátí data z tabulky jako JSON (webová aplikace, kterou čte web)
// adresa s parametrem ?historie=1 vrátí časové řady z listu Historie (volitelně &id=btc jen pro jedno aktivum)
function doGet(e) {
  // když web chce historii, vrátí ji a končí
  if (e && e.parameter && e.parameter.historie) return historieJson_(e.parameter.id);
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
    // dopočítá změny za den, týden, měsíc a rok z listu Historie (ČNB je nedodává)
    doplnZmeny_(kurzy);
    // zapíše nové kurzy a změny do tabulky
    zapisCeny_(kurzy);
    // uloží denní snímek všech cen do listu Historie (po zápisu, aby v něm byly dnešní ceny)
    ulozSnimekHistorie_();
  } catch (err) {
    // chybu uloží do listu Log
    zalogujChybu_('aktualizujStabilniMakrodata', err);
  }
}

/**
 * JEDNORÁZOVĚ (spustit ručně): zpětné doplnění Historie kurzů EUR a USD z ročních souborů ČNB
 */
function zpetneDoplnKurzy() {
  try {
    // roky, které se doplní (rok 365 dní zpět může sahat do předchozího roku)
    const roky = [new Date().getFullYear() - 1, new Date().getFullYear()];
    // sem se naskládají řádky [id, datum, cena]
    const radky = [];
    // projde oba roky
    roky.forEach((rok) => {
      // adresa ročního souboru ČNB (jeden řádek na den, sloupec na měnu)
      const url = 'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/rok.txt?rok=' + rok;
      // stáhne soubor a rozdělí ho na neprázdné řádky
      const r = stahni_(url).split('\n').filter((x) => x.trim() !== '');
      // první řádek je hlavička: Datum|1 AUD|1 BGN|...
      const hlavicka = r[0].split('|').map((x) => x.trim());
      // najde sloupec s eurem (1 EUR)
      const iEur = hlavicka.indexOf('1 EUR');
      // najde sloupec s dolarem (1 USD)
      const iUsd = hlavicka.indexOf('1 USD');
      // když sloupce chybí, změnil se formát souboru
      if (iEur < 0 || iUsd < 0) throw new Error('V hlavičce ročního souboru ČNB ' + rok + ' chybí 1 EUR nebo 1 USD');
      // projde datové řádky
      r.slice(1).forEach((radek) => {
        // rozdělí řádek podle svislítka
        const c = radek.split('|');
        // datum je ve tvaru dd.MM.rrrr
        const d = c[0].trim().split('.');
        // vadné řádky přeskočí
        if (d.length !== 3) return;
        // přeskládá datum na rrrr-mm-dd
        const datum = d[2] + '-' + ('0' + d[1]).slice(-2) + '-' + ('0' + d[0]).slice(-2);
        // kurz eura jako číslo (desetinná čárka na tečku)
        const eur = parseFloat(String(c[iEur]).replace(',', '.'));
        // kurz dolaru jako číslo
        const usd = parseFloat(String(c[iUsd]).replace(',', '.'));
        // přidá euro, když je číslo
        if (eur) radky.push(['eur-czk', datum, eur]);
        // přidá dolar, když je číslo
        if (usd) radky.push(['usd-czk', datum, usd]);
      });
    });
    // zapíše jen chybějící dny, existující nepřepisuje
    zapisDoHistorie_(radky, false);
  } catch (err) {
    // chybu uloží do listu Log
    zalogujChybu_('zpetneDoplnKurzy', err);
  }
}

/**
 * JEDNORÁZOVĚ (spustit ručně): zpětné doplnění Historie kryptoměn z CoinGecko (denní ceny za 365 dní)
 */
function zpetneDoplnKrypto() {
  try {
    // vezme demo klíč CoinGecko z Vlastností skriptu
    const klic = PropertiesService.getScriptProperties().getProperty('COINGECKO_KEY');
    // bez klíče nemá smysl pokračovat
    if (!klic) throw new Error('Ve Vlastnostech skriptu chybí COINGECKO_KEY');
    // dnešní datum se nezapisuje, to dělá denní snímek
    const dnes = datumPred_(0);
    // sem se naskládají řádky [id, datum, cena]
    const radky = [];
    // projde všechny sledované mince
    KRYPTO.forEach((k) => {
      try {
        // adresa CoinGecko: denní ceny v USD za posledních 365 dní
        const url = 'https://api.coingecko.com/api/v3/coins/' + k.cg + '/market_chart?vs_currency=usd&days=365&interval=daily';
        // stáhne odpověď a pošle klíč v hlavičce
        const odpoved = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'x-cg-demo-api-key': klic } });
        // jiný kód než 200 je chyba této mince, ostatní se zkusí dál
        if (odpoved.getResponseCode() !== 200) throw new Error('HTTP ' + odpoved.getResponseCode() + ' z CoinGecko pro ' + k.cg);
        // převede odpověď na objekt a vezme pole cen [čas, cena]
        const ceny = JSON.parse(odpoved.getContentText('UTF-8')).prices || [];
        // projde všechny body
        ceny.forEach((b) => {
          // převede čas v milisekundách na datum rrrr-mm-dd v UTC (CoinGecko dává denní body o půlnoci UTC)
          const datum = Utilities.formatDate(new Date(b[0]), 'UTC', 'yyyy-MM-dd');
          // dnešek a vadné body přeskočí
          if (datum === dnes || !(b[1] > 0)) return;
          // přidá řádek
          radky.push([k.id, datum, b[1]]);
        });
      } catch (err) {
        // chybu jedné mince uloží do Logu a pokračuje další mincí
        zalogujChybu_('zpetneDoplnKrypto ' + k.id, err);
      }
      // pauza mezi dotazy, aby demo klíč nenarazil na limit dotazů za minutu
      Utilities.sleep(2500);
    });
    // zapíše jen chybějící dny, existující nepřepisuje
    zapisDoHistorie_(radky, false);
  } catch (err) {
    // chybu uloží do listu Log
    zalogujChybu_('zpetneDoplnKrypto', err);
  }
}
