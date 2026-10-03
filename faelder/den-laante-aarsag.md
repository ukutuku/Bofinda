---
navn: den-lånte-årsag
form: ikke-vaern
faelde: en forklaring, der passer på de datapunkter, man så
kilde: #59 (hotfix/referrer-og-osm-beredskab) på 99a8c30, CLAUDE.md linje 1118
---
**De øvrige i samme tabel.** En årsag, der forklarer to tal, læses som
årsagen til alle — og prøves ikke mod resten, netop fordi den passede.
**Målt:** tegntal og bytetal for tabellens rækker afveg med 7 på begge
`main`-rækker, og forklaringen «det er `\| **navn** ·`-præfikset» passede.
Den er forkert: forskellen er **UTF-8**, og den var 7 begge gange, fordi
begge rækker tilfældigvis har 5 flerbyte-tegn. Mod de samme to rækker på en
anden gren er den **12 og 35**, og på de tre nye **27, 54 og 31** — altså
ikke en konstant forskydning, men æøå og «» talt op. **Teorien forudsagde en
konstant og blev aldrig prøvet mod de fire tal i samme tabel, hvor den
varierer.** Modtrækket er ikke en bedre forklaring, men at prøve den mod det
datapunkt, der ikke var med til at danne den. **Og den praktiske følge:
skriv enheden ved tallet.** Tegn eller bytes — i dansk prosa er forskellen
op mod 3 % og vokser med teksten, så en tabel med begge slags tal uden enhed
er en sammenligning, der ikke er en sammenligning. **Og differencen er IKKE
antallet af flerbyte-tegn:** tre-byte-tegn — tankestreg, ellipse, «» —
tæller dobbelt. Målt på denne rækkes nabo `ordet-maalt`: 47 flerbyte-tegn
giver 54 bytes ekstra, fordi 40×1 + 7×2 = 54, og de syv er alle
tankestreger. Uden den linje ser ens egen kontrol ud som en regnefejl.
**Tredje forekomst, og den er den vigtigste: jeg trådte i formen MENS jeg
skrev rækken om den** — forklaringen om præfikset stod i selve den besked,
hvor jeg katalogiserede en andens lånte årsag. De to andre gange i denne
weekend fangede tabellen en forfatter af sin egen række og en læser; **denne
udelukker den indvending, de ikke kan — at tabellen kun fanger dem, der ikke
kender den.** Her kendte forfatteren formen, var i gang med at beskrive den,
og trådte i den alligevel. Det er evidens for, at modtrækket skal være
**mekanisk og ikke opmærksomhed**: **prøv forklaringen mod det datapunkt,
der ikke var med til at danne den.** **Og grunden til, at det kan være
mekanisk, er at man aldrig mangler dataene — man mangler at vende
spørgsmålet mod dem.** Fem forekomster er gennemgået, og i hver eneste lå
det modbevisende datapunkt allerede i hånden: tidsstemplet var dannet af
kommentarens og aldrig prøvet mod afsenderens egne; årsagen var dannet af en
API-måling og aldrig prøvet mod koden, den handlede om; nummereringen var
dannet af en liste, nogen selv udvidede, og aldrig prøvet mod rækkens tekst;
navnene var dannet af chat-rapporter og aldrig prøvet mod repoet (målt: **23
åbne PR'er, samtlige som `ukutuku`** — ét `gh api`-kald); og byteforskellen
var dannet af to tal, hvor den tilfældigvis var ens, og aldrig prøvet mod de
fire i samme tabel. **Det manglende var aldrig oplysninger. Det var
skridtet** — og derfor kan det stå i en tjekliste frem for at kræve flid.
