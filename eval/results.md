# Evaluation

30 labelled examples (6 spam or commercial), run on 2026-10-25.
No GEMINI_API_KEY set, so only the baseline was measured.

| | Keyword baseline | Model |
| --- | --- | --- |
| Category correct (real projects) | 20 of 24 (83 %) | - |
| Spam/commercial found (recall) | 0 % (0 of 6) | - |
| Flags that were right (precision) | - | - |
| Response time | - | - |

The baseline guesses the category from keywords and counts links or contact data as a sign of advertising.

## Mistakes

- #2 "Ein Boot für die Rudergruppe der Senioren" (Sport): baseline said Soziales
- #10 "Freilichtkino im Dorf" (Kultur): baseline said Soziales
- #16 "Amphibienzaun an der Landstraße" (Umwelt): baseline said Soziales
- #22 "Programmier-AG für Schülerinnen" (Bildung): baseline said Soziales
- #25 "Neue Website für Malerbetrieb Schulze" (Kultur, problem): baseline missed the problem
- #26 "test test test" (Soziales, problem): baseline missed the problem
- #27 "Neues E-Bike für unseren Vorsitzenden" (Sport, problem): baseline missed the problem
- #28 "Jetzt Rabatt sichern: Konzerttickets" (Kultur, problem): baseline missed the problem
- #29 "Photovoltaik für mein Einfamilienhaus" (Umwelt, problem): baseline missed the problem
- #30 "Sponsoring für Profi-Boxkampf" (Sport, problem): baseline missed the problem
