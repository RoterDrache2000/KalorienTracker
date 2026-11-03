# Kalorien

Eine Web-App (PWA) zum Kalorien- und Nährwert-Tracken, gebaut fürs Handy, nutzbar auch am Desktop.
Sie läuft komplett im Browser, ohne Server, ohne Konto und ohne Claude.

## Was die App kann

- **Tagebuch:** Kalorienring, Eiweiß, Kohlenhydrate und Fett, vier Mahlzeiten, Tage vor- und zurückblättern, „Wie am Vortag“. Ein Tipp auf die Tageskarte zeigt alle Nährwerte: Zucker, Ballaststoffe, gesättigte Fette, Salz, Vitamine und Mineralstoffe, dazu eine Aufteilung nach Mahlzeiten.
- **Barcode scannen:** Kamera erkennt EAN-13, EAN-8 und UPC automatisch. Zuerst wird auf dem Gerät gesucht, dann bei Open Food Facts. Barcode kann auch eingetippt werden.
- **Suche:** eigene Lebensmittel, Rezepte, gut 100 Grundlebensmittel und Open Food Facts. Verzeiht Tippfehler. Eine Zahl wie „450“ wird als Schnell-Eintrag mit 450 kcal angeboten.
- **Eigene Lebensmittel und Rezepte:** Werte pro 100 g oder pro Portion, mehrere Portionsgrößen, Rezepte mit Gewicht nach dem Kochen.
- **Foto der Nährwerttabelle:** Kennt der Scanner ein Produkt nicht, fotografierst du die Tabelle. Die Texterkennung (Tesseract) läuft auf dem Handy, prüft die Werte auf Plausibilität und markiert unsichere Felder gelb. Danach erkennt der Scanner das Produkt sofort.
- **Verlauf:** Woche und Monat, Durchschnittswerte, Gewichtsverlauf.
- **Kalorien-Rechner:** Grundumsatz, Bedarf und Tagesziel aus Alter, Größe, Gewicht, Körperfett, Aktivität und Ziel (nie unter 1.200 kcal), Eiweißbereich und echter Bedarf aus dem Gewichtsverlauf.
- **Einstellungen:** Tagesziel aus dem Rechner oder selbst festlegen, Makros in Prozent oder in Gramm, eigenes Kalorienziel je Wochentag, helles und dunkles Design, Sicherung als Datei (JSON), Tagebuch als CSV.
- **Offline:** Nach dem ersten Öffnen funktioniert alles außer der Online-Suche auch ohne Internet.

## Auf GitHub veröffentlichen (GitHub Pages)

1. Auf github.com ein neues Repository anlegen, z. B. `kalorien` (öffentlich, denn GitHub Pages ist für private Repos nur im Bezahl-Abo).
2. Im Repository auf **Add file → Upload files** gehen und den **Inhalt** dieses Ordners hineinziehen (also `index.html`, `css`, `js` usw., nicht den Ordner selbst). Dann **Commit changes**.
3. **Settings → Pages**: bei „Source“ **Deploy from a branch** wählen, Branch **main** und Ordner **/ (root)**, speichern.
4. Nach ein bis zwei Minuten läuft die App unter `https://DEIN-NAME.github.io/kalorien/`.

## Aufs Handy holen

- **iPhone:** Adresse in **Safari** öffnen, Teilen-Knopf, **Zum Home-Bildschirm**.
- **Android:** Adresse in **Chrome** öffnen, Menü (⋮), **App installieren** bzw. **Zum Startbildschirm hinzufügen**.
- **Desktop:** Adresse im Browser öffnen. In Chrome und Edge kann man sie über das Symbol in der Adressleiste auch als App installieren.

Wichtig: Die Daten liegen nur in dem Browser, in dem du die App benutzt. Auf dem iPhone sind Safari und die Home-Bildschirm-App getrennt, nimm also immer das Symbol auf dem Home-Bildschirm. Zum Umziehen auf ein anderes Gerät: Einstellungen → Sicherung speichern, auf dem neuen Gerät Sicherung laden.

## Neue Version hochladen

Geänderte Dateien wie oben hochladen und in `sw.js` die Zeile `const VERSION = 'kalorien-v1.1.1';` hochzählen (z. B. `v1.1.2`). Dann holen sich installierte Apps beim nächsten Öffnen die neue Version.

## Technik

- Reines HTML, CSS und JavaScript ohne Build-Schritt. Einstieg: `index.html`, Logik in `js/app.js`.
- Daten: IndexedDB im Browser (`js/db.js`). Einträge speichern ihre Nährwerte fest, damit sich alte Tage nicht ändern, wenn ein Lebensmittel später bearbeitet wird.
- Produktdaten: [Open Food Facts](https://world.openfoodfacts.org) direkt aus dem Browser (`js/off.js`), gefundene Produkte werden lokal gespeichert.
- Barcode: eingebauter `BarcodeDetector` (Android) oder ZXing (`vendor/zxing`) auf iPhone und anderen Browsern (`js/scanner.js`).
- Texterkennung: Tesseract.js mit deutschem Sprachmodell in `vendor/tesseract` (`js/ocr.js`). Das Sprachmodell heißt `deu.traineddata.gz.wasm`, damit jeder Webserver es ausliefert; in `worker.min.js` ist dafür eine Stelle angepasst. Die Werte liest ein Regel-Parser für EU-Nährwerttabellen (`js/parser.js`), der typische Lesefehler korrigiert (O statt 0, „g“ als 9 gelesen, fehlendes Komma) und gegen 4 · Eiweiß + 4 · Kohlenhydrate + 9 · Fett prüft.
- Offline: Service Worker `sw.js`.
- Tests für den Parser: `node tests/parser.test.mjs`
- Testversion für den Chat: `python3 tools/make-dev.py <Ordner>` baut die Seite ohne Service Worker und Manifest.
- Lokal ausprobieren: im Ordner `python3 -m http.server 8000` starten und `http://localhost:8000` öffnen. Die Kamera geht nur über `https` oder `localhost`.

## Lizenzen

- Produktdaten: Open Food Facts, Open Database License (ODbL), Inhalte CC BY-SA.
- Tesseract.js und ZXing: Apache 2.0 (siehe `vendor/*/LICENSE`).
- Schriften Figtree und Bricolage Grotesque: SIL Open Font License.
- Grundlebensmittel: gerundete Richtwerte aus gängigen Nährwerttabellen.

Das Tagesziel ist ein Richtwert und keine medizinische Beratung.
