# Tetris – přetlačovaná

Tetris pro dva hráče na jedné klávesnici. Stačí otevřít `index.html` v prohlížeči.

## Pravidla

- Hrací pole má 10 sloupců a 40 řad. Na začátku dostane každý hráč polovinu, tedy 20 řad.
- Hráč 1 hraje shora, kostky mu padají ke středu. Hráč 2 hraje zdola, kostky mu „padají“ nahoru ke středu.
- Dokončená plná řada nezmizí, ale **zaútočí**. Síla útoku závisí na tom, kolik řad hráč dokončí jednou kostkou:

  | Plné řady najednou | 1 | 2 | 3 | 4 (Tetris) |
  |--------------------|---|---|---|-------------|
  | Síla útoku         | 1 | 2 | 4 | 6           |

- Každá jednotka útoku udělá jednu z těchto věcí:
  - **Soupeř má ve středu zeď:** tvoje řada a jedna řada soupeřovy zdi se navzájem zničí. Hranice se vrátí o řadu zpět a ty získáš řadu místa.
  - **Soupeř zeď nemá:** řada se změní ve tvou **zeď** uprostřed. Zeď i se všemi soupeřovými kostkami se posune o řadu k soupeři, takže mu ubude jedna řada místa.
  - Bonusové jednotky (síla nad počet řad) fungují stejně, jen nespotřebují žádnou tvou řadu.
- Zeď je proto vždy jen jedné barvy a její výška ukazuje, o kolik řad vede hráč, kterému patří. Hrací pole se nezanáší.
- Hráč prohraje, když se mu nová kostka nevejde na jeho polovinu, nebo když ho soupeř vytlačí přes okraj pole.

## Zobrazení: jedno pole, nebo dvě pole

Na úvodní obrazovce, během pauzy a po konci hry si hráči tlačítkem nebo klávesou `M` vyberou zobrazení. Volba se pamatuje i po zavření prohlížeče.

- **Jedno pole:** obě poloviny jsou v jednom společném poli. Hráč 1 hraje shora, hráč 2 zdola.
- **Dvě pole:** každý hráč má své pole a kostky mu padají shora. Pole hráče 2 ukazuje stejnou hru, jen svisle převrácenou. Každý tak vidí svou polovinu nahoře a pod čárou ve středu sleduje soupeře. Pravidla se nemění.

## Ovládání

| Akce            | Hráč 1         | Hráč 2 – jedno pole | Hráč 2 – dvě pole |
|-----------------|----------------|---------------------|-------------------|
| Pohyb           | `A` / `D`      | `←` / `→`           | `←` / `→`         |
| Otočení         | `W`            | `↓`                 | `↑`               |
| Zrychlení       | `S`            | `↑`                 | `↓`               |
| Shození         | `Mezerník`     | `Enter`             | `Enter`           |

`P` nebo `Esc` hru pozastaví, `R` spustí novou hru (během pauzy nebo po konci hry), `M` přepne zobrazení (mimo běžící hru).
