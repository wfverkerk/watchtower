# Watchtower

Watchtower is een Vue-app om basketbalwedstrijden live statistieken bij te houden. Wedstrijdgegevens worden lokaal in de browser opgeslagen, zodat de logger zonder netwerkverbinding bruikbaar blijft.

Je kunt een wedstrijd delen met een code. Andere scorers nemen anoniem deel vanaf hun eigen apparaat en houden een onafhankelijke registratie bij. Nieuwe acties, correcties en ongedaan gemaakte acties worden als afzonderlijke events met scorer-ID opgeslagen; offline events worden later gesynchroniseerd. De eventgegevens vormen de basis voor latere vergelijking, maar een vergelijkingsscherm is nog niet aanwezig.

De interface is beschikbaar in het Nederlands, Engels en Tsjechisch. De taalkeuze wordt apart van wedstrijdgegevens op dit apparaat bewaard.

Bij rake en gemiste 2- en 3-puntsschoten kun je de locatie vastleggen op een halve veldkaart. Voor een schot vanaf eigen helft volstaat de aparte strook bij de middenlijn.

## Ontwikkeling

Vereist Node.js 26 LTS en npm. De aanbevolen Node-versie staat in `.nvmrc` (bij gebruik van nvm: `nvm install` en `nvm use`).

TypeScript blijft voorlopig op versie 6: de Vue/Volar-typechecker ondersteunt TypeScript 7 nog niet.

```sh
npm install
npm run dev
```

## Controleren

```sh
npm test
npm run build
```

## Structuur

- `src/components/` bevat de scoreweergave, invoer, wedstrijdactiviteit en selectiedialogen, waaronder de halve veldkaart voor schotlocaties.
- `src/composables/useGameSession.ts` beheert de wedstrijdsessie, UI-workflows en lokale opslag.
- `src/domain/game.ts` bevat domeintypen, wedstrijdregels, afgeleide statistieken en normalisatie van opgeslagen data.
- `src/services/` verzorgt lokale wedstrijd-/eventopslag en de Supabase-sync.
- `supabase/migrations/` bevat het schema, de RLS-beleidsregels en de functies voor gedeelde wedstrijden.
- `src/i18n/` bevat de Nederlandse, Engelse en Tsjechische teksten en taalkeuze.
- `src/domain/game.test.ts` test de wedstrijdregels en opslagcompatibiliteit.

De lokale wedstrijd wordt opgeslagen onder `watchtower-game-v1`. Verwijder deze browseropslag niet om bestaande wedstrijden te behouden.
De actieve gedeelde wedstrijd en de niet-gesynchroniseerde eventwachtrij staan onder `watchtower-shared-match-v1` en `watchtower-match-events-v1`.

## Gedeelde wedstrijden instellen

1. Maak een Supabase-project en schakel **Anonymous Sign-Ins** in bij Authentication.
2. Voer de SQL-bestanden in `supabase/migrations/` op volgorde van bestandsnaam uit in de SQL-editor van Supabase:
   - [`20261110000000_shared_match_events.sql`](./supabase/migrations/20261110000000_shared_match_events.sql)
   - [`20261111000000_shared_match_size_limits.sql`](./supabase/migrations/20261111000000_shared_match_size_limits.sql)
   - [`20261111000000_zoebas_team_catalog.sql`](./supabase/migrations/20261111000000_zoebas_team_catalog.sql)
   - [`20261111000100_zoebas_team_staff.sql`](./supabase/migrations/20261111000100_zoebas_team_staff.sql)
   - [`20261111000200_zoebas_team_staff_roles.sql`](./supabase/migrations/20261111000200_zoebas_team_staff_roles.sql)
3. Kopieer `.env.example` naar `.env.local` en vul de project-URL en publishable/anon key in. Deze client key is bedoeld voor gebruik in de browser; de database vertrouwt op RLS-beleid en anonieme Supabase Auth-sessies.
4. Herstart `npm run dev`. Deel vanuit de app de wedstrijdcode met andere scorers.

Bij het eerste gebruik stel je lokaal je naam, favoriete Zoebas-teams en voorkeurstaal in. Via het profiel rechtsboven kun je deze voorkeuren later aanpassen. De wizard toont daarna alleen je favoriete teams en laadt per team programma en uitslagen uit de publieke FOYS-competitie-API. Een wedstrijd die binnen 15 minuten begint of net is begonnen wordt voorgesteld; oudere wedstrijden blijven ook selecteerbaar. Als de API geen wedstrijden levert, kun je de tegenstander handmatig invoeren.

De app bewaart de actieve wedstrijd en niet-gesynchroniseerde events lokaal. Nieuwe acties, wijzigingen en verwijderingen blijven per anonieme scorer gescheiden in `match_events`; de wedstrijd-roster wordt bij het aanmaken als uitgangspunt gedeeld. Een scorer kan offline blijven registreren nadat die online aan de gedeelde wedstrijd is toegevoegd. Bij herstellen van de verbinding worden events opnieuw geprobeerd te synchroniseren.

De startwizard laadt de Zoebas-teams, spelersvoornamen en bekende coaches en assistent-coaches met hun rol uit `zoebas_teams` in Supabase. De stafmigraties voegen deze informatie toe; rugnummers en selecties van spelers en staf worden per apparaat bij de teamprofielen bewaard. Niet-vermelde coaches of assistent-coaches kun je daar zelf toevoegen.

De ruwe registraties zijn in Supabase te vergelijken via de `match_events`-tabel, gefilterd op `match_id` en gesorteerd op `occurred_at`. `tracker_id` is de vaste anonieme apparaatidentiteit; `tracker_name` is de gekozen weergavenaam. De UI voor het naast elkaar vergelijken van registraties volgt later.

## Testen via GitHub Pages

De workflow in [deploy-pages.yml](./.github/workflows/deploy-pages.yml) publiceert de tijdelijke testbranch `agents/pages-current-version` op `https://wfverkerk.github.io/watchtower/`. De site is publiek toegankelijk. Een push naar deze branch start een deployment. Om later vanaf een andere branch te publiceren, pas zowel de workflow als de toegestane branches van de GitHub Pages-omgeving aan.

1. Stel in de GitHub-repository bij **Settings → Secrets and variables → Actions → Variables** `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` in. Gebruik de project-URL en de publieke publishable/anon key, **niet** de service-role key. Deze waarden worden in de publiek beschikbare app opgenomen.
2. Configureer Supabase zoals hierboven beschreven, inclusief anonieme aanmelding en alle nog ontbrekende migraties.
3. Kies bij **Settings → Pages → Build and deployment → Source** voor **GitHub Actions**. Controleer daarna de workflow bij **Actions** en open de site op je telefoon.

Browseropslag is per apparaat en per websiteadres gescheiden. Een lokale wedstrijd op je computer verschijnt dus niet automatisch op je telefoon. Deel een wedstrijdcode om de gedeelde sync te testen.

## Testgegevens eenmalig wissen

**Let op:** hiermee verdwijnen alle gedeelde wedstrijden, leden en events definitief, ook die van andere scorers. Oude wedstrijdcodes werken daarna niet meer. Lokale wedstrijden, profielen en wachtende events op andere apparaten blijven bestaan; start daar een nieuwe gedeelde wedstrijd om een oude koppeling te vervangen.

Voer eerst alle migraties hierboven uit. Maak vervolgens een SQL-script met de bestaande team- en stafseed:

```sh
node scripts/print-test-reset.mjs | pbcopy
```

Plak de volledige inhoud in de Supabase SQL Editor en voer die als één query uit. De verwijderingen en het opnieuw vullen van de catalogus gebeuren in één transactie; bij een fout wordt deze niet gecommit. Het script draait daarna `ANALYZE` op de betrokken tabellen. De teamcatalogus wordt gevuld met de gegevens uit de migraties, niet opnieuw opgehaald uit FOYS; wedstrijdprogramma's worden door de app apart bij FOYS opgehaald.
