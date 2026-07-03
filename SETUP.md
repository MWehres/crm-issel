# ProSales CRM v25 – Einrichtung Firebase-Sicherheit

Mit v25 wurde das Login auf **Firebase Authentication** umgestellt und die
Datenbank gegen unbefugten Zugriff abgesichert. Damit das CRM wieder
funktioniert, sind **einmalig** die folgenden Schritte in der
[Firebase-Konsole](https://console.firebase.google.com/) nötig
(Projekt: `crm-issel`). Dauer: ca. 15 Minuten.

> **Warum?** Bisher lag ein fest eingebautes Zugriffstoken im HTML-Quelltext –
> jeder mit Zugriff auf die Datei/Seite konnte die komplette Kundendatenbank
> lesen, ändern und löschen. Außerdem lagen Passwort-Hashes offen in der
> Datenbank. Beides ist mit v25 behoben, sobald die Schritte unten erledigt sind.

---

## Schritt 1: E-Mail/Passwort-Anmeldung aktivieren

1. Firebase-Konsole → **Authentication** → Tab **Sign-in method**
2. **E-Mail/Passwort** aktivieren (nur die erste Option, ohne "E-Mail-Link")

## Schritt 2: Web-API-Key eintragen

1. Firebase-Konsole → ⚙️ **Projekteinstellungen** → Tab **Allgemein**
2. Den **Web-API-Key** kopieren (beginnt mit `AIza…`).
   Dieser Key ist **kein Geheimnis** – er identifiziert nur das Projekt.
   Der Schutz kommt aus den Security Rules (Schritt 4).
3. In `index.html` die Zeile suchen und den Key eintragen:

   ```js
   const FB_API_KEY_EMBED = '';   // ← hier den Key einfügen
   ```

   Alternativ zeigt der Login-Screen ein Eingabefeld an, solange kein Key
   hinterlegt ist – dann muss der Key aber **auf jedem Gerät einmal**
   eingegeben werden. Der Eintrag in `index.html` ist der bequemere Weg.

## Schritt 3: Benutzerkonten anlegen

1. Firebase-Konsole → **Authentication** → Tab **Users** → **Add user**
2. Für jeden Mitarbeiter E-Mail + Passwort anlegen.
3. **Wichtig:** Das Konto, das sich als **erstes** im CRM anmeldet, wird
   automatisch **Administrator**. Alle weiteren werden normale Benutzer
   (Rolle danach über Zahnrad-Menü → Benutzerverwaltung änderbar).
4. Danach können neue Benutzer auch direkt im CRM angelegt werden
   (Benutzerverwaltung → "+ Neuer Benutzer" erstellt das Firebase-Konto mit).

## Schritt 4: Security Rules setzen

Firebase-Konsole → **Realtime Database** → Tab **Regeln** → ersetzen durch:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

→ **Veröffentlichen**. Ab jetzt kommt nur noch rein, wer angemeldet ist.

## Schritt 5: Altes Zugriffstoken entwerten & Altlasten löschen

Das alte Token (`IssEL-CRM-2024-…`) steht in der Git-Historie und in alten
Kopien der Datei – es muss entwertet werden:

1. Falls unter **Projekteinstellungen → Dienstkonten → Datenbankgeheimnisse**
   noch ein Legacy-Secret existiert: löschen bzw. neu generieren.
2. Sobald die Rules aus Schritt 4 aktiv sind, funktioniert das alte
   `?auth=<token>`-Schema ohnehin nicht mehr – die Rules sind der
   entscheidende Schutz.
3. **Realtime Database → Daten**: den Knoten **`auth_users`** löschen
   (enthält die alten Passwort-Hashes). Er wird nicht mehr benötigt.

## Schritt 6: Datenübernahme (passiert automatisch)

- Die App nutzt ab v25 die neue Struktur **`crm2/`** (datensatzbasiert).
- Beim **ersten Sync nach dem Login** werden die Bestandsdaten aus `crm/`
  automatisch nach `crm2/` übernommen. Der alte Knoten `crm/` bleibt als
  Backup unangetastet liegen.
- Wenn nach einigen Tagen alles rund läuft: `crm/` in der Konsole löschen.

---

## Benutzerverwaltung im Alltag

| Aktion | Wo |
|---|---|
| Benutzer anlegen | CRM → Zahnrad → Benutzerverwaltung (erstellt Firebase-Konto + Profil) |
| Passwort vergessen | Benutzer bearbeiten → "Passwort-Reset-E-Mail senden" |
| Rolle/Abteilung ändern | Benutzer bearbeiten |
| Benutzer deaktivieren | Benutzer bearbeiten → Häkchen "Aktiv" entfernen |
| Benutzer endgültig sperren | Zusätzlich in der Firebase-Konsole (Authentication → Users → Konto deaktivieren/löschen) – das Deaktivieren im CRM ist nur eine App-Sperre |

## Offline-Verhalten

- Ohne Netz startet die App im **Offline-Modus** mit den lokal
  zwischengespeicherten Daten (sofern auf dem Gerät schon einmal ein
  Login erfolgte). Änderungen werden synchronisiert, sobald Firebase
  wieder erreichbar ist.
- Eine **erstmalige** Anmeldung auf einem neuen Gerät braucht Netz.

## Empfehlung: SRI-Hashes für CDN-Dateien (optional)

Leaflet wird von unpkg.com geladen. Gegen manipulierte CDN-Auslieferung
können `integrity`-Attribute ergänzt werden. Hashes so erzeugen:

```bash
for u in "leaflet@1.9.4/dist/leaflet.js" "leaflet@1.9.4/dist/leaflet.css" \
         "leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js" \
         "leaflet.markercluster@1.5.3/dist/MarkerCluster.css" \
         "leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"; do
  echo "$u  sha384-$(curl -sL "https://unpkg.com/$u" | openssl dgst -sha384 -binary | openssl base64 -A)"
done
```

Die Werte dann als `integrity="sha384-…" crossorigin="anonymous"` an die
jeweiligen `<script>`/`<link>`-Tags in `index.html` hängen.

## Tests

Die Merge-Logik der Sync-Engine ist mit Node-Tests abgedeckt:

```bash
node tests/sync-merge.test.mjs
```
