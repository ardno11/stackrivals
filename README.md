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

## Ovládání

| Akce            | Hráč 1 (shora) | Hráč 2 (zdola) |
|-----------------|----------------|----------------|
| Pohyb           | `A` / `D`      | `←` / `→`      |
| Otočení         | `W`            | `↓`            |
| Zrychlení       | `S`            | `↑`            |
| Shození         | `Mezerník`     | `Enter`        |

`P` nebo `Esc` hru pozastaví, `R` spustí novou hru (během pauzy nebo po konci hry).
