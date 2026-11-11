# Watchtower

Watchtower is een Vue-app om basketbalwedstrijden live statistieken bij te houden. Wedstrijdgegevens worden lokaal in de browser opgeslagen, zodat de logger zonder netwerkverbinding bruikbaar blijft.

Je kunt een wedstrijd delen met een code. Andere scorers nemen anoniem deel vanaf hun eigen apparaat en houden een onafhankelijke registratie bij. Nieuwe acties, correcties en ongedaan gemaakte acties worden als afzonderlijke events met scorer-ID opgeslagen; offline events worden later gesynchroniseerd. De eventgegevens vormen de basis voor latere vergelijking, maar een vergelijkingsscherm is nog niet aanwezig.

De interface is beschikbaar in het Nederlands, Engels en Tsjechisch. De taalkeuze wordt apart van wedstrijdgegevens op dit apparaat bewaard.

Bij rake en gemiste 2- en 3-puntsschoten kun je de locatie vastleggen op een halve veldkaart. Voor een schot vanaf eigen helft volstaat de aparte strook bij de middenlijn.

## Ontwikkeling

Vereist Node.js en npm.

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
   - [`20261111000000_zoebas_team_catalog.sql`](./supabase/migrations/20261111000000_zoebas_team_catalog.sql)
   - [`20261111000100_zoebas_team_staff.sql`](./supabase/migrations/20261111000100_zoebas_team_staff.sql)
   - [`20261111000200_zoebas_team_staff_roles.sql`](./supabase/migrations/20261111000200_zoebas_team_staff_roles.sql)
3. Kopieer `.env.example` naar `.env.local` en vul de project-URL en publishable/anon key in. Deze client key is bedoeld voor gebruik in de browser; de database vertrouwt op RLS-beleid en anonieme Supabase Auth-sessies.
4. Herstart `npm run dev`. Deel vanuit de app de wedstrijdcode met andere scorers.

Bij het eerste gebruik stel je lokaal je naam, favoriete Zoebas-teams en voorkeurstaal in. Via het profiel rechtsboven kun je deze voorkeuren later aanpassen. De wizard toont daarna alleen je favoriete teams en laadt per team programma en uitslagen uit de publieke FOYS-competitie-API. Een wedstrijd die binnen 15 minuten begint of net is begonnen wordt voorgesteld; oudere wedstrijden blijven ook selecteerbaar. Als de API geen wedstrijden levert, kun je de tegenstander handmatig invoeren.

De app bewaart de actieve wedstrijd en niet-gesynchroniseerde events lokaal. Nieuwe acties, wijzigingen en verwijderingen blijven per anonieme scorer gescheiden in `match_events`; de wedstrijd-roster wordt bij het aanmaken als uitgangspunt gedeeld. Een scorer kan offline blijven registreren nadat die online aan de gedeelde wedstrijd is toegevoegd. Bij herstellen van de verbinding worden events opnieuw geprobeerd te synchroniseren.

De startwizard laadt de Zoebas-teams, spelersvoornamen en bekende coaches en assistent-coaches met hun rol uit `zoebas_teams` in Supabase. De stafmigraties voegen deze informatie toe; rugnummers en selecties van spelers en staf worden per apparaat bij de teamprofielen bewaard. Niet-vermelde coaches of assistent-coaches kun je daar zelf toevoegen.

De ruwe registraties zijn in Supabase te vergelijken via de `match_events`-tabel, gefilterd op `match_id` en gesorteerd op `occurred_at`. `tracker_id` is de vaste anonieme apparaatidentiteit; `tracker_name` is de gekozen weergavenaam. De UI voor het naast elkaar vergelijken van registraties volgt later.
