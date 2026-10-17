# Cenový radar

Backend Cenového detektoru: skript pro Google Apps Script, který automaticky
aktualizuje ceny v Google Tabulce a poskytuje je webu jako JSON.

## Jak to funguje

- `aktualizujStabilniMakrodata` – 1x denně stáhne kurzy EUR a USD z ČNB.
- `aktualizujVolatilniTrhy` – každých 6 hodin stáhne ceny 20 kryptoměn a jejich změny za den, týden, měsíc a rok z CoinGecko (potřebuje bezplatný demo klíč ve Vlastnostech skriptu pod názvem `COINGECKO_KEY`).
- `doGet` – webová aplikace vrací data z tabulky jako JSON
  (změny `day`, `week`, `month`, `year` jsou zlomky, např. `-0.004` = -0,4 %).
- Chyby se zapisují do listu `Log` v tabulce.

## Nasazení

1. V Google Tabulce otevři Rozšíření → Apps Script a vlož `Kod.gs` a `appsscript.json`.
2. Spusť libovolnou funkci a povol oprávnění (tabulky + externí požadavky).
3. V Spouštěčích přidej časové spouštěče pro obě `aktualizuj*` funkce.
4. Implementuj jako webovou aplikaci (`doGet`).
