# Watchtower

Watchtower is een Vue-app om basketbalwedstrijden live statistieken bij te houden. Wedstrijdgegevens worden lokaal in de browser opgeslagen, zodat de logger zonder netwerkverbinding bruikbaar blijft.

De interface is beschikbaar in het Nederlands, Engels en Tsjechisch. De taalkeuze wordt apart van wedstrijdgegevens op dit apparaat bewaard.

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

- `src/components/` bevat de scoreweergave, invoer, wedstrijdactiviteit en selectiedialogen.
- `src/composables/useGameSession.ts` beheert de wedstrijdsessie, UI-workflows en lokale opslag.
- `src/domain/game.ts` bevat domeintypen, wedstrijdregels, afgeleide statistieken en normalisatie van opgeslagen data.
- `src/services/gameStorage.ts` verzorgt het laden en bewaren van de wedstrijd in localStorage.
- `src/i18n/` bevat de Nederlandse, Engelse en Tsjechische teksten en taalkeuze.
- `src/domain/game.test.ts` test de wedstrijdregels en opslagcompatibiliteit.

De lokale wedstrijd wordt opgeslagen onder `watchtower-game-v1`. Verwijder deze browseropslag niet om bestaande wedstrijden te behouden.
