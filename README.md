# Watchtower

Watchtower is een Vue-app om basketbalwedstrijden live statistieken bij te houden. Wedstrijdgegevens worden lokaal in de browser opgeslagen, zodat de logger zonder netwerkverbinding bruikbaar blijft.

Na het instellen van je profiel zie je op de startpagina de wedstrijden van vandaag en de aankomende wedstrijden uit het programma. Tik op een wedstrijd en kies je thuis- of uitteam om te registreren. Een wedstrijd start en sluit vanzelf: de sessie wordt geopend bij de eerste registratie, en sluit na drie uur of na dertig minuten zonder events. Andere scorers houden een onafhankelijke registratie bij; acties en correcties worden als events opgeslagen en na netwerkherstel gesynchroniseerd.

De interface is beschikbaar in het Nederlands, Engels en Tsjechisch. De taalkeuze wordt apart van wedstrijdgegevens op dit apparaat bewaard.

Bij rake en gemiste 2- en 3-puntsschoten kun je de locatie vastleggen op een halve veldkaart. Voor een schot vanaf eigen helft volstaat de aparte strook bij de middenlijn.

Acties die natuurlijk op elkaar volgen worden als vragenreeks in de invoerpopup aangeboden, met een voortgangsbalk bovenaan: een raak schot vraagt eerst de scorer, daarna de assistgever (of geen assist) en dan de schotlocatie. Bij een gemist schot vraag je daarna wie de rebound pakte: een speler uit de vijf spelers in het veld, de tegenstander, of geen rebound. Een rebound van de tegenstander wordt zonder speler opgeslagen als verdedigende rebound. Missers en rebounds horen bij dezelfde actie, zodat ongedaan maken ze samen verwijdert.

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
De actieve gedeelde wedstrijd en de niet-gesynchroniseerde wachtrijen staan onder `watchtower-shared-match-v1`, `watchtower-match-events-v1` en `watchtower-match-snapshots-v1`.
Afgesloten lokale wedstrijden en hun indienstatus staan onder `watchtower-local-matches-v1`. Wis de browseropslag niet zolang er gegevens zijn die je wilt bewaren of synchroniseren.

## Gedeelde wedstrijden instellen

1. Maak een Supabase-project en schakel **Anonymous Sign-Ins** in bij Authentication.
2. Voer de SQL-bestanden in `supabase/migrations/` op volgorde van bestandsnaam uit in de SQL-editor van Supabase:
   - [`20261206000000_baseline.sql`](./supabase/migrations/20261206000000_baseline.sql) (het volledige schema van Watchtower, zonder testdata, met de referentiedata: Zoebas-teams, competities en statistiekteams, de realtime-publicatie en de publieke bucket `logos`. Nieuw project: voer dit ene bestand uit. Bestaande projecten hebben dit schema al)
   - [`20261207000000_schedule_standings.sql`](./supabase/migrations/20261207000000_schedule_standings.sql) (kolommen voor competitie, team-ids en ranglijstpositie per wedstrijd in `zoebas_schedule`)

Eenmalig op een bestaand project om oude gedeelde wedstrijden te verwijderen: voer [`scripts/delete-shared-matches.sql`](./scripts/delete-shared-matches.sql) uit in de SQL-editor. Dat verwijdert alle gedeelde wedstrijden, hun events en de teamstatistieken die daaruit zijn gemaakt. Teams, spelers, het programma en coachtoegang blijven bestaan.

De Edge Function `sync-zoebas-schedule` haalt het programma per competitie op uit de FOYS-API (met header `X-FederationId`). Een pg_cron-taak roept hem dagelijks om 03:00 Amsterdamse tijd aan; het `SYNC_SECRET` staat in de Supabase-secrets en in Vault (`sync_zoebas_schedule_secret`). Met `?mode=standings` legt de functie de ranglijstpositie van de teams vast voor alle aankomende wedstrijden van de lopende week. Dat gebeurt één keer per week, bij de eerste verversing op maandag; daarna blijven die posities staan. De workflow [zoebas-standings.yml](./.github/workflows/zoebas-standings.yml) roept de modus elk half uur tussen 09:00 en 23:00 Amsterdamse tijd aan, zodat een mislukte maandagrun later op de week alsnog wordt ingehaald. Voeg daarvoor het `SYNC_SECRET` toe als GitHub-secret (`Settings → Secrets and variables → Actions`).
3. Kopieer `.env.example` naar `.env.local` en vul de project-URL en publishable/anon key in. Deze client key is bedoeld voor gebruik in de browser; de database vertrouwt op RLS-beleid en anonieme Supabase Auth-sessies.
4. Controleer dat Supabase Realtime is ingeschakeld en dat `match_events`, `shared_matches` en `match_score_links` in de publicatie `supabase_realtime` staan. De migratie voegt deze toe als de publicatie bestaat.
5. Herstart `npm run dev`. Kies op de startpagina een wedstrijd uit het programma.

Bij het eerste gebruik stel je lokaal je naam, taal en weergave in. Via het profiel rechtsboven kun je deze voorkeuren later aanpassen. Start een wedstrijd en kies een Zoebas-team en de deelnemende spelers; vul voor de spelers ook hun rugnummers in. De wizard laadt programma en uitslagen uit de publieke FOYS-competitie-API. Bij een handmatig ingevoerde tegenstander zijn ook datum en aanvangstijd verplicht. De tegenstander krijgt voorlopig vijf tijdelijke spelers (`player_1` tot en met `player_5`) met fictieve nummers; een deelnemer die voor de uit-ploeg registreert beheert zijn eigen spelerslijst.

De tegenstander kies je in de laatste wizardstap met een zoekveld met suggesties uit de tabel `opponent_teams`. Deze tabel wordt bij het uitvoeren van de baseline-migratie gevuld uit de bestanden in de publieke Storage-bucket `logos` (gif, png, jpg, jpeg en webp, zonder submappen): de bestandsnaam zonder extensie is de teamnaam. De naam wordt in de database in de vorm `Sv Zoebas` opgeslagen (eerste letter van elk woord hoofdletter) en `logo_file` bewaart de exacte bestandsnaam voor het logo. Controleer afkortingen als `BC` of `CBV` en pas de naam zo nodig aan in de tabel; zoeken is niet hoofdlettergevoelig. Nieuwe logo's voeg je later toe met een `insert` in `opponent_teams`. Een niet gevonden tegenstander blijft als vrije tekst mogelijk. De lijst wordt lokaal gecached voor offline gebruik; logo's zijn alleen zichtbaar met internet. De logo's worden getoond via de publieke URL van de bucket; de baseline-migratie zet de bucket `logos` daarom op publiek. Bij een privé-bucket geeft Supabase "Bucket not found" en blijven de logo's leeg.

Sessies zijn voor alle appgebruikers zichtbaar. Deelnemen kan vanaf tien minuten voor de opgegeven aanvang, tot 180 minuten daarna of totdat de maker of bevoegde coach de sessie sluit. De aangewezen live-scorer bepaalt de getoonde stand; de maker of een bevoegde coach kan deze scorer wijzigen. Andere registraties worden in het live-overzicht per score zo goed mogelijk gekoppeld, met een onzekerheidsmelding en handmatige correctie. Niet-gekoppelde acties blijven zichtbaar als aanvullende acties. De gewone registratie en het scorebord op je eigen apparaat blijven onafhankelijk van de live-stand.

Per wedstrijd is er één scorer. Tik je op een wedstrijd zonder scorer, dan kies je expliciet tussen **Scorer worden** (met de melding dat je de verantwoordelijkheid voor de registratie op je neemt, plus de keuze welk team je scoort) en **Meekijken**; ook een wedstrijd die nog niet gestart is kun je zo bekijken, met de melding dat er nog geen scorer is. Heeft de wedstrijd al een scorer, dan kijk je direct mee; ben je zelf de scorer, dan ga je verder waar je was. Een kijker heeft een eigen pagina zonder actieknoppen: het scorebord, de spelers in het veld en het wedstrijdverloop, live bijgewerkt. Voor de opstelling en de periode deelt de scorer deze gegevens via `match_live_state` (alleen de scorer kan dit schrijven). Sluit de scorer de wedstrijd af, dan verschijnt een volledig scherm met een basketbalanimatie en een bedankje (tik, Enter of Escape slaat over; verminderde beweging toont een statisch scherm), waarna je terugkeert naar het wedstrijdoverzicht. Kijkers zien bij het einde van de wedstrijd dezelfde animatie met de eindstand. Een scorer kan nog niet worden overgenomen vanuit de app; dat volgt in een latere stap.

Een lokale wedstrijd blijft op het apparaat bewaard na afsluiten. Je kunt deze later met internet indienen als nieuwe gedeelde wedstrijd of bij een bestaande sessie met dezelfde teamnamen en aanvangstijd; als beide wedstrijden een programma-ID hebben, moeten ook die overeenkomen. Indienen kan ook na sluiting van de sessie. Bij een onzekere netwerkuitkomst moet de indiening met dezelfde account en hetzelfde doel opnieuw worden geprobeerd. Lokale wedstrijden staan niet automatisch in de teamstatistiekhistorie.

Een wedstrijd die niet in het programma staat, zoals een oefenwedstrijd, start je via het oefenwedstrijdicoon in het topmenu (naast Statistieken) met **Oefenwedstrijd starten**. Op die pagina staan ook de lokaal afgesloten wedstrijden die je kunt indienen; na het afsluiten van een lokale wedstrijd opent deze pagina vanzelf. Je kiest een Zoebas-team en de deelnemende spelers, en voert de tegenstander zelf in: kies of typ de club en vul eventueel het team in. Club en team worden net als bij de thuisclub apart getoond; op het wedstrijdscherm staat alleen de teamnaam en wordt de club met het logo aangeduid. Een getypte club die niet in de lijst staat krijgt een placeholder-logo. Zonder team geldt de clubnaam als teamnaam. Er staan alvast vijf tegenstanders met rugnummers 4 t/m 8 en de namen `Speler 4` t/m `Speler 8` klaar; pas ze aan, verwijder ze of voeg spelers toe (minimaal twee, met naam en rugnummer). Voor de tegenstander registreer je net als anders alleen de score; de spelerslijst wordt bij de wedstrijd bewaard. Een oefenwedstrijd is een lokale wedstrijd zonder sessievenster: hij opent of sluit niet automatisch en loopt totdat je hem zelf afsluit. Zolang hij loopt staat hij op dit apparaat bij **Vandaag open** met de status Live en de actuele stand; tik erop om verder te gaan. Andere apparaten zien hem niet. Het moment van aanmaken wordt als datum en aanvangstijd vastgelegd. Na afsluiten dien je hem met internet in als nieuwe gedeelde wedstrijd; daarna wordt hij met jou als officiële scorer aan de teamstatistieken van het gekozen team toegevoegd. Daarvoor heb je toegang tot dat team nodig (teamcode of coach); lukt het niet, voeg dan het team toe via **Statistieken** en kies **Toevoegen aan teamstatistieken** bij de wedstrijd. In de statistieken tellen oefenwedstrijden standaard niet mee in totalen, trends en historie; met **Oefenwedstrijden meetellen** neem je ze op.

Een account dat al acties of een lokale inzending in die sessie heeft, kan geen tweede lokale registratie bij dezelfde sessie indienen: die zou anders als dezelfde scorer worden opgeteld in plaats van gekoppeld.

Een eerder opgehaalde teamcatalogus is offline beschikbaar. Ontbreekt die, dan kun je bij een lokale wedstrijd zelf een team en spelers invoeren. Het lokale team is geen gedeeld catalogusteam. Om de app zelf offline te openen moet deze eerder online zijn geladen of geïnstalleerd.

In dialoogvensters blijft de toetsenbordfocus binnen het venster. Met Escape kun je een venster sluiten wanneer annuleren mogelijk is; de focus keert dan waar mogelijk terug naar de knop waarmee je het opende.

Via het profiel rechtsboven kun je met **App lokaal resetten** na bevestiging opnieuw beginnen. Dit verwijdert de lokale Watchtower-gegevens op dit apparaat, inclusief niet-gesynchroniseerde acties, maar laat servergegevens en de Supabase-aanmelding ongemoeid.

Op het wedstrijdscherm kies je twee tot vijf actieve Zoebas-spelers om de eerste periode te starten. Met **Volgende periode** bevestig of wijzig je de opstelling voor iedere volgende periode; annuleren laat de huidige periode intact. Je kunt ook vóór 00:00 doorgaan. Tijdens een periode kun je blijven wisselen.

Met **Spelers bewerken** pas je vóór en tijdens de wedstrijd dezelfde spelerslijst aan als in de wizard. Geef iemand als afwezig op in plaats van die te verwijderen; bestaande wedstrijdacties blijven bewaard. De opstelling kies je afzonderlijk. Tijdens de wedstrijd stopt het openen van de spelerseditor de klok.

De spelers op het veld staan met naam en rugnummer bij de wisselknop onder het scorebord; deze balk blijft tijdens het scrollen zichtbaar. Bij lange namen kun je de spelerslijst horizontaal scrollen. Voor de tegenstander registreer je alleen de score met de knoppen +1, +2 en +3 in het actiegebied. Deze scores worden als acties zonder toegewezen speler opgeslagen en gesynchroniseerd; je kunt ze afzonderlijk verwijderen in het wedstrijdoverzicht of de laatste actie ongedaan maken.

De klok start je per periode handmatig en kun je pauzeren, ook tijdens de rust; de wedstrijd pauzeren stopt de klok eveneens. X10-, X12- en V12-teams spelen acht periodes van vier minuten, andere teams vier kwarten van tien minuten. Zodra de vierde jeugdperiode of het tweede kwart op 00:00 komt, start automatisch een pauze van tien minuten. Je start de volgende periode zelf; verlengingen duren vijf minuten. De klok gebruikt verstreken tijd en loopt dus ook door wanneer het tabblad gesloten is.

Bij vijf teamfouten verschijnt een rood vierkantje onder de teamnaam. Voor jeugd tellen periodes 1–2, 3–4, 5–6 en 7–8 samen; andere teams tellen per kwart. Verlengingen tellen door bij de laatste periodegroep. Veldspelers kunnen een persoonlijke fout (P, genummerd P1 t/m P5), onsportieve fout (U), technische fout (T) of diskwalificerende fout (D) krijgen. Coaches krijgen C of D en bankspelers B of D; C en B zijn technische fouten, en een D is altijd diskwalificerend. Technische fouten, fouten van coaches en bankspelers en een D van een bankspeler of coach tellen niet mee voor het teamfoutenaantal; een D van een veldspeler wel. Bij vijf persoonlijke fouten van een veldspeler verschijnt een rood vierkantje achter de naam, en een zesde P is niet mogelijk. Bestaande fouten zonder periode worden bij de huidige periode ingedeeld.
Het wedstrijdverloop toont acties, wissels (spelers erin en eruit) en het begin en einde van periodes of kwarten. Nieuwe regels verschijnen met een korte animatie in de teamkleur; periodegebeurtenissen hebben een neutrale kleur. Bij verminderde beweging is de animatie uitgeschakeld. Het einde wordt geregistreerd bij 00:00 of wanneer je eerder naar de volgende periode gaat; de eerste opstelling is geen wissel. De periode, klok, opstelling en dit verloop worden lokaal opgeslagen. Bij gedeelde wedstrijden zijn ze onderdeel van de beginsnapshot; latere klok-, periode-, opstellings- en verloopwijzigingen worden momenteel niet tussen apparaten gesynchroniseerd. De geregistreerde fouten worden wel als actie-events gesynchroniseerd, inclusief hun periode.

De app bewaart de actieve wedstrijd en niet-gesynchroniseerde events lokaal. Nieuwe acties, wijzigingen en verwijderingen blijven per anonieme scorer gescheiden in `match_events`; de wedstrijd-roster wordt bij het aanmaken als uitgangspunt gedeeld. Een scorer kan offline blijven registreren nadat die online aan de gedeelde wedstrijd is toegevoegd. Bij herstellen van de verbinding worden events opnieuw geprobeerd te synchroniseren, ook na het wisselen van wedstrijd. Events van een andere apparaatidentiteit blijven bewaard en melden een synchronisatiefout; ze kunnen alleen met de oorspronkelijke identiteit worden verstuurd. De resetknop verwijdert ook niet-gesynchroniseerde events.

## Teamstatistieken en coaches

De beheerder voert de nieuwe migratie uit vóór het uitrollen van de app. Deze maakt per bestaand catalogusteam een geheime teamcode en geeft iedere bestaande catalogusspeler een eigen UUID; ook spelers met dezelfde naam krijgen afzonderlijke IDs. Nieuwe private spelers worden door een coach toegevoegd. Hun naam staat afzonderlijk opgeslagen en is alleen toegankelijk voor bevoegde coaches; teamleden met de teamcode zien hun rugnummer en statistieken. De gedeelde wedstrijdgegevens gebruiken voor deze spelers een anoniem label. Eerder openbaar gemaakte gegevens, waaronder bestaande teamcatalogi en oudere wedstrijdkopieën, worden niet automatisch privé gemaakt of gewist.

Een vertrouwde beheerder kan in de Supabase SQL-editor de code van één team opzoeken en veilig aan teamleden bezorgen:

```sql
select access_code from public.statistics_teams where id = 'x12-1';
```

De teamcode geeft toegang tot de historie van dat team, maar geen coachrechten. Deel hem daarom alleen met personen die de teamhistorie mogen zien. De bestaande wedstrijdcode geeft toegang tot de gegevens van die wedstrijd en is iets anders dan de teamcode. Statistieken zijn per team; een speler die bij een ander team gaat spelen krijgt daar niet automatisch dezelfde identiteit of de historie van het vorige team.

Schakel in Supabase Auth naast anonieme aanmelding ook aanmelden via e-mail met een magic link in. Voeg de URL van de app toe aan de toegestane redirect-URL's. Een coach meldt zich aan via **Instellingen → Coach inloggen** en opent de link op hetzelfde apparaat en in dezelfde browser/app. Safari en de iPhone-beginschermapp hebben afzonderlijke opslag en delen hun aanmelding niet. Aanmelden zelf geeft nog geen coachrechten: nadat de coach voor het eerst is aangemeld, kent een beheerder die rechten per team toe met de gebruikers-ID uit Supabase Auth:

```sql
insert into public.statistics_coaches (team_id, user_id)
values ('x12-1', '00000000-0000-0000-0000-000000000000');
```

Vervang de voorbeeldwaarden door het team en de juiste, niet-anonieme gebruikers-ID. Verwijder een rij uit `statistics_coaches` om die coachrechten in te trekken. Teamleden met een code behouden zelfstandig toegang totdat hun rij in `statistics_team_members` wordt verwijderd; vervang zo nodig ook de teamcode. Een aangemelde coach kan spelers toevoegen en wijzigen op de statistiekenpagina. Kies bij een nieuwe wedstrijd **Gedeelde spelerslijst gebruiken** in de spelersstap om de vaste spelers-ID's te gebruiken. Bestaande lokale spelers blijven beschikbaar maar worden bij die keuze aanvankelijk op afwezig gezet, zodat ze niet automatisch met naamgenoten worden samengevoegd.

Voor teamstatistieken moet de wedstrijd gedeeld zijn. Via **Wedstrijd afsluiten** kies je met internet een team en één officiële scorer. Iedere wedstrijddeelnemer mag de officiële scorer later wijzigen. De pagina toont de laatst ontvangen stand van elke scorer; nog niet gesynchroniseerde acties kunnen daarin ontbreken. Latere correcties en vertraagde synchronisatie van de gekozen scorer werken de historische statistieken bij. Acties van verschillende scorers worden niet opgeteld. De klok stopt bij afsluiten; correcties blijven mogelijk zolang de wedstrijd op het apparaat actief is.

Aanvullingen van andere scorers verwerken de historische statistieken wel: de officiële scorer-snapshot blijft het anker voor score en teamtotalen, en de huidige acties van andere scorers (online en offline ingediend) worden daaraan gekoppeld met dezelfde regels als de live-weergave (team, punten en periode; handmatige koppelingen gelden). Daarbij vullen ze een ontbrekende speler, schotpositie of assist aan. Niet-gekoppelde scores en overige acties van andere scorers tellen niet mee, zodat niets dubbel wordt geteld. Je kunt in een sessie ook voor de uit-ploeg registreren (**Ik registreer voor** in de sessielijst). Je eigen team staat dan bovenaan, je beheert je eigen spelerslijst, en je registratie krijgt geen catalogusteam: je kunt hem dus niet als officiële scorer voor de statistieken van het thuisteam gebruiken. Statistieken voor het uitteam zelf zijn nog niet beschikbaar, omdat een wedstrijd één officiële scorer en één statistiekteam kent. Spelersnamen van andere scorers worden bewust niet gedeeld; in de live-weergave verschijnen onbekende spelers als zodanig. Een nieuw aangewezen live-scorer kan een achterlopende eigen registratie hebben; de stand van een andere scorer wordt niet continu naar diens apparaat gekopieerd.

Wedstrijdspelers met een gedeelde UUID worden automatisch gekoppeld; andere wedstrijdspelers moet een deelnemer aan de wedstrijd op de historiepagina handmatig koppelen. Tot die tijd ontbreken ze in de spelerstotalen. Lifetime-totalen en trends bevatten alleen afgesloten, gekoppelde wedstrijden van het gekozen team. Bestaande lokale wedstrijden zijn niet automatisch beschikbaar als historie.

Een scorer-snapshot bevat geen spelersnamen en wordt samen met de eventwachtrij lokaal bewaard bij netwerkuitval, ook als je naar een andere wedstrijd wisselt. Wijzigt dezelfde scorer op twee apparaten tegelijk, dan meldt de app een conflict en blijven de lokale gegevens bewaard; er wordt niet automatisch een registratie overschreven. Een scherm om dergelijke conflicten samen te voegen is nog niet beschikbaar: de historie kan achterlopen totdat een beheerder dit heeft opgelost. Gebruik dezelfde scorer daarom niet gelijktijdig in meerdere tabbladen of op meerdere apparaten. Wisselen tussen anoniem en coach is alleen mogelijk na afsluiten en synchroniseren van de actieve gedeelde wedstrijd en alle wachtrijen. Een inloglink die tijdens een actieve wedstrijd binnenkomt, wordt niet automatisch verwerkt. Gebruik de resetknop niet zolang acties of snapshots nog niet zijn gesynchroniseerd. De gedeelde historie en het afsluiten zijn alleen online beschikbaar.

De startwizard laadt de Zoebas-teams en spelersvoornamen uit `zoebas_teams` in Supabase. Coaches staan niet meer in de teamlijst of opstelling; bij een fout kies je de vaste coach van het team. Spelers zijn bij een nieuwe wizard standaard aanwezig; een onafgemaakt concept behoudt de gemaakte keuzes. Rugnummers van spelers uit de teamlijst worden bij doorgaan naar de tegenstander in Supabase opgeslagen en op andere apparaten opgehaald. Ook wijzigingen aan deze nummers in de wedstrijdeditor worden gedeeld. Deze nummers zijn openbaar leesbaar en door iedere bezoeker aanpasbaar. Gelijktijdige wijzigingen worden gecontroleerd; bij een conflict moet je de gedeelde nummers opnieuw laden en controleren. Zelf toegevoegde spelers, coaches en hun gegevens blijven lokaal.

Wijzigingen aan het team in de wizard worden als lokaal concept bewaard, ook als je de pagina herlaadt voordat de wedstrijd is aangemaakt. Behalve de gedeelde rugnummers zijn teamgegevens browser- en apparaatspecifiek. De resetknop verwijdert ook dit concept, maar niet de gedeelde rugnummers.

De ruwe registraties zijn in Supabase te vergelijken via de `match_events`-tabel, gefilterd op `match_id` en gesorteerd op `sequence_id`. `tracker_id` is de apparaatidentiteit; `tracker_name` is de gekozen weergavenaam.

## Publiceren via GitHub Pages

De workflow in [deploy-pages.yml](./.github/workflows/deploy-pages.yml) publiceert `main` automatisch op `https://wfverkerk.github.io/watchtower/` zodra er naar `main` wordt gepusht of een pull request wordt gemerged. De tests en de build moeten slagen; anders wordt er niets gepubliceerd. Handmatig opnieuw publiceren kan via **Actions → Deploy GitHub Pages → Run workflow**. De site is publiek toegankelijk.

Databasemigraties worden niet automatisch uitgevoerd. Voer een nieuwe migratie uit in de SQL-editor van Supabase vóórdat je de bijbehorende wijziging naar `main` merget.

1. Stel in de GitHub-repository bij **Settings → Secrets and variables → Actions → Variables** `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` in. Gebruik de project-URL en de publieke publishable/anon key, **niet** de service-role key. Deze waarden worden in de publiek beschikbare app opgenomen.
2. Configureer Supabase zoals hierboven beschreven, inclusief anonieme aanmelding en alle nog ontbrekende migraties.
3. Kies bij **Settings → Pages → Build and deployment → Source** voor **GitHub Actions**. Controleer daarna de workflow bij **Actions** en open de site op je telefoon.

Browseropslag is per apparaat en per websiteadres gescheiden. Een lokale wedstrijd op je computer verschijnt dus niet automatisch op je telefoon. Open dezelfde sessie op beide apparaten om gedeelde sync te testen.

### App op je beginscherm

Open de gepubliceerde site op je telefoon en kies in de browser **Deel → Zet op beginscherm** (iPhone) of **Toevoegen aan startscherm / App installeren** (Android). Open de app daarna via het nieuwe icoon. Op iPhone hebben Safari en de beginschermapp afzonderlijke opslag: lokale wedstrijden, instellingen en niet-gesynchroniseerde acties worden niet automatisch overgenomen. Synchroniseer eventuele acties eerst en open de gedeelde sessie opnieuw. Klok, opstelling en lokaal wedstrijdverloop worden daarbij niet doorlopend overgezet.

Na een eerste online bezoek kan de app offline opstarten. Voor het ophalen van de teamcatalogus, deelnemen aan een gedeelde wedstrijd en synchroniseren blijft internet nodig. Offline acties worden opnieuw gesynchroniseerd wanneer de app met verbinding actief is. Een nieuwe versie wordt pas na alle oude vensters te sluiten of via **Bijwerken** geladen; die knop is niet beschikbaar terwijl de wedstrijdklok loopt.

Via **Profiel en voorkeuren** kun je instellen of het scherm tijdens een actieve wedstrijd aan blijft. Dit staat standaard aan, werkt alleen terwijl de app zichtbaar is en hangt af van browser, apparaat en energiebesparing.

Onderaan **Profiel en voorkeuren** staat de buildcode voor probleemonderzoek. Bij GitHub Pages zijn dit de eerste 12 tekens van de gepubliceerde commit; de ontwikkelserver toont `dev` en lokale productiebuilds krijgen een eigen `local-` code.

## Testgegevens eenmalig wissen

**Let op:** hiermee verdwijnen alle gedeelde wedstrijden, leden en events definitief, ook die van andere scorers. Lokale wedstrijden, profielen en wachtende events op andere apparaten blijven bestaan; start daar een nieuwe gedeelde wedstrijd om een oude koppeling te vervangen.

Voer eerst alle migraties hierboven uit. Maak vervolgens een SQL-script met de bestaande team- en stafseed:

```sh
node scripts/print-test-reset.mjs | pbcopy
```

Plak de volledige inhoud in de Supabase SQL Editor en voer die als één query uit. De verwijderingen en het opnieuw vullen van de catalogus gebeuren in één transactie; bij een fout wordt deze niet gecommit. Het script draait daarna `ANALYZE` op de betrokken tabellen. De teamcatalogus wordt gevuld met de gegevens uit de migraties, niet opnieuw opgehaald uit FOYS; wedstrijdprogramma's worden door de app apart bij FOYS opgehaald.
