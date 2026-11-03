// Eigene Inhaltsstoff-Liste für den Inhaltsstoff-Check. Läuft offline, keine fremde Bewertung.
// Stufen: 0 = unbedenklich (grün), 1 = eingeschränkt empfehlenswert (gelb), 2 = einschränken (orange), 3 = problematisch (rot).
// Jede Einstufung hat eine Begründung (R) und eine Quelle (Q). Stand der Prüfung: CHECKED.
// Die Bewertung gilt pro Stoff und berücksichtigt nicht die Menge im Produkt.

export const CHECKED = 'November 2026';

export const LEVELS = [
  { l: 'Unbedenklich', c: 'var(--lv0)' },
  { l: 'Eingeschränkt empfehlenswert', c: 'var(--lv1)' },
  { l: 'Einschränken', c: 'var(--lv2)' },
  { l: 'Problematisch', c: 'var(--lv3)' },
];

export const Q = {
  eudb: ['EU-Datenbank Lebensmittelzusatzstoffe', 'https://food.ec.europa.eu/safety/food-improvement-agents/additives/database_en'],
  efsa: ['EFSA: Lebensmittelzusatzstoffe', 'https://www.efsa.europa.eu/de/topics/topic/food-additives'],
  south: ['EU-Verordnung 1333/2008, Anhang V (Warnhinweis Farbstoffe)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32008R1333'],
  tio2: ['EU-Verordnung 2022/63 (Verbot von E 171)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32022R0063'],
  aspartame: ['WHO/IARC: Aspartam-Bewertung 2023', 'https://www.who.int/news/item/14-07-2023-aspartame-hazard-and-risk-assessment-results-released'],
  cosing: ['EU-Datenbank CosIng', 'https://single-market-economy.ec.europa.eu/sectors/cosmetics/cosmetic-ingredient-database_en'],
  kvo: ['EU-Kosmetikverordnung 1223/2009', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32009R1223'],
  sccs: ['Wissenschaftlicher Ausschuss für Verbrauchersicherheit (SCCS)', 'https://health.ec.europa.eu/scientific-committees/scientific-committee-consumer-safety-sccs_en'],
  mit: ['EU-Verordnung 2016/1198 (Methylisothiazolinone)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32016R1198'],
  parab: ['EU-Verordnungen 358/2014 und 1004/2014 (Parabene)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32014R1004'],
  cmr: ['EU-Verordnung 2021/1902 (CMR-Stoffe in Kosmetik)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32021R1902'],
  micro: ['EU-Verordnung 2023/2055 (Mikroplastik)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32023R2055'],
  uv: ['EU-Verordnung 2022/1176 (UV-Filter)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32022R1176'],
  silox: ['EU-Verordnung 2018/35 (D4 und D5)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32018R0035'],
  form: ['EU-Verordnung 2022/1181 (Formaldehyd-Abspalter)', 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32022R1181'],
};

// Begründungen (je zwei Sätze)
export const R = {
  ok: 'In der EU zugelassen und von der EFSA bewertet. Bei üblichem Verzehr sind keine Bedenken bekannt.',
  nat: 'Natürlicher Stoff oder Naturfarbstoff, in der EU zugelassen. Bei üblichem Verzehr sind keine Bedenken bekannt.',
  south: 'Lebensmittel mit diesem Farbstoff müssen in der EU den Hinweis „kann Aktivität und Aufmerksamkeit bei Kindern beeinträchtigen“ tragen. Grundlage ist eine Studie der Universität Southampton von 2007.',
  azo: 'Synthetischer Farbstoff, in der EU zugelassen. Einige Menschen reagieren empfindlich, er hat keinen Nutzen außer der Farbe.',
  carmin: 'Wird aus Schildläusen gewonnen und ist deshalb nicht vegan. Kann selten Allergien auslösen.',
  annatto: 'Natürlicher Farbstoff, der selten allergische Reaktionen auslösen kann. Die EFSA hat die erlaubte Tagesmenge 2016 bestätigt.',
  caramel: 'Bei der Herstellung kann 4-Methylimidazol entstehen, das die WHO-Krebsforschungsagentur IARC als möglicherweise krebserregend einstuft. In der EU gibt es dafür einen Höchstgehalt.',
  tio2food: 'Seit 2022 als Lebensmittelzusatz in der EU verboten. Die EFSA konnte eine erbgutschädigende Wirkung nicht ausschließen.',
  benzoate: 'Kann zusammen mit Vitamin C in Getränken geringe Mengen Benzol bilden. Bei empfindlichen Menschen sind Unverträglichkeiten möglich.',
  paraben: 'Parabene stehen im Verdacht, hormonähnlich zu wirken. In Lebensmitteln sind nur wenige zugelassen, die EFSA sieht für einige Datenlücken.',
  sulfite: 'Kann bei empfindlichen Menschen, vor allem bei Asthma, Beschwerden auslösen und ist deshalb kennzeichnungspflichtig. Die EFSA sah 2016 Datenlücken und mögliche Überschreitungen bei Vielverzehrern.',
  formaldf: 'Gibt Formaldehyd ab, das als krebserregend eingestuft ist. Nur noch für wenige Käsesorten zugelassen.',
  nitrite: 'Kann beim Braten und im Körper Nitrosamine bilden, die als krebserregend gelten. Die EFSA hält die Grenzwerte für ausreichend, rät aber, die Aufnahme gering zu halten.',
  nitrate: 'Wird im Körper teilweise zu Nitrit umgewandelt, aus dem Nitrosamine entstehen können. Bei üblichem Verzehr laut EFSA sicher, die Aufnahme sollte aber gering bleiben.',
  gallate: 'Kann bei empfindlichen Menschen Allergien auslösen. Die EFSA hat für Propylgallat die Tagesmenge 2014 nur vorläufig festgelegt.',
  bha: 'Die IARC stuft BHA als möglicherweise krebserregend ein. Außerdem besteht der Verdacht auf hormonelle Wirkung.',
  bht: 'In hohen Mengen zeigten Tierstudien Wirkungen auf Leber und Schilddrüse. Die EFSA hat die erlaubte Tagesmenge 2012 trotzdem leicht angehoben.',
  tbhq: 'In der EU zugelassen, die EFSA nennt mögliche Überschreitungen der Tagesmenge bei Vielverzehrern. Tierstudien zeigen in hohen Dosen Wirkungen auf das Immunsystem.',
  phosphate: 'Die EFSA hat 2019 einen Gruppengrenzwert für Phosphate festgelegt, den Kinder und Vielverzehrer überschreiten können. Zu viel Phosphat belastet Nieren und Gefäße.',
  carrageenan: 'Die EFSA bezeichnete 2018 die Datenlage als unsicher und forderte weitere Studien. Tierstudien deuten auf Entzündungen im Darm hin.',
  emuls: 'In der EU zugelassen. Tierstudien deuten darauf hin, dass manche Emulgatoren Darmschleimhaut und Darmflora beeinflussen können.',
  polyol: 'Zuckeraustauschstoff. Größere Mengen wirken abführend, darauf muss die Packung hinweisen.',
  sweet: 'Zugelassener Süßstoff ohne Kalorien. Wie er auf Darmflora und Appetit wirkt, wird noch erforscht.',
  aspartame: 'Die IARC hat Aspartam 2023 als möglicherweise krebserregend eingestuft. Die erlaubte Tagesmenge von 40 mg pro kg Körpergewicht bleibt laut WHO unverändert.',
  glutamate: 'Die EFSA hat 2017 eine Gruppen-Tageshöchstmenge festgelegt, die Vielverzehrer überschreiten können. Manche Menschen reagieren mit Kopfschmerzen oder Übelkeit.',
  purine: 'Wird im Körper zu Harnsäure abgebaut. Menschen mit Gicht sollten darauf achten.',
  silica: 'In der EU zugelassen. Die EFSA sah 2018 Datenlücken, vor allem zu Nanopartikeln.',
  aluminium: 'Enthält Aluminium. Die EFSA rät, die gesamte Aluminiumaufnahme gering zu halten.',
  natamycin: 'Antibiotisch wirkender Stoff für Käserinde und Wurstpelle. Rinde mit Natamycin sollte nicht gegessen werden.',
  egg: 'Wird aus Hühnereiweiß gewonnen und ist für Menschen mit Ei-Allergie relevant.',
  palm: 'Kein Zusatzstoff, aber reich an gesättigten Fetten. Beim Raffinieren können Schadstoffe wie Glycidyl-Ester entstehen.',
  trans: 'Teilweise gehärtete Fette können Transfette enthalten, die das Herz-Kreislauf-Risiko erhöhen. In der EU sind sie seit 2021 begrenzt.',
  food: 'Gewöhnliche Lebensmittelzutat, kein Zusatzstoff.',
  // Kosmetik
  c_ok: 'Gut verträglicher, häufig verwendeter Stoff. Es sind keine besonderen Bedenken bekannt.',
  c_oil: 'Pflanzliches Öl oder Fett, pflegt die Haut. Es sind keine besonderen Bedenken bekannt.',
  c_mild: 'Mildes Tensid aus Zucker oder Aminosäuren. Gilt als hautfreundlich.',
  cab: 'Mildes Tensid, das aber in seltenen Fällen Kontaktallergien auslösen kann, meist durch Verunreinigungen.',
  sles: 'Waschaktive Substanz, etwas milder als SLS, kann aber bei häufiger Anwendung die Haut austrocknen. Bei der Herstellung kann 1,4-Dioxan als Verunreinigung entstehen.',
  sls: 'Starkes Tensid, das die Hautbarriere angreifen und Reizungen auslösen kann. Wird in Studien sogar gezielt als Reizstoff eingesetzt.',
  fragr: 'Sammelbegriff für Duftstoffe, die einzelnen Stoffe stehen nicht auf der Packung. Duftstoffe gehören zu den häufigsten Auslösern von Kontaktallergien.',
  fallerg: 'Duftstoff, der als Allergieauslöser bekannt ist und deshalb in der EU ab einer bestimmten Menge angegeben werden muss. Für Menschen mit empfindlicher Haut weniger geeignet.',
  fstrong: 'Starker Allergieauslöser unter den Duftstoffen. Die EU begrenzt die erlaubte Menge.',
  fban: 'In der EU seit 2022 in Kosmetik verboten, weil er als fortpflanzungsgefährdend eingestuft wurde bzw. stark allergen ist. Ältere Produkte können ihn noch enthalten.',
  phenoxy: 'Häufiger Konservierer, in erlaubter Menge laut SCCS sicher. Kann bei empfindlicher Haut reizen.',
  paraben_ok: 'Kurzkettiges Paraben, laut SCCS in den erlaubten Mengen sicher. Manche Menschen meiden Parabene trotzdem wegen des Verdachts auf hormonelle Wirkung.',
  paraben_bad: 'Langkettiges Paraben mit Verdacht auf hormonähnliche Wirkung. Die EU hat die erlaubte Menge gesenkt und es für Babyprodukte im Windelbereich verboten.',
  paraben_ban: 'In der EU seit 2014 in Kosmetik verboten, weil Daten zur Sicherheit fehlen.',
  mit: 'Starker Kontaktallergieauslöser. In der EU in Produkten, die auf der Haut bleiben, verboten und in abwaschbaren Produkten streng begrenzt.',
  formald: 'Gibt Formaldehyd ab, das als krebserregend eingestuft ist und Allergien auslöst. Seit 2024 muss „setzt Formaldehyd frei“ auf der Packung stehen, wenn die Menge eine Schwelle überschreitet.',
  triclosan: 'Antibakterieller Stoff mit Verdacht auf hormonelle Wirkung, der zur Bildung resistenter Keime beitragen kann. In der EU stark eingeschränkt.',
  silicone: 'Silikon, das Haut und Haare glatt wirken lässt, aber schwer abbaubar ist. Kann sich bei häufiger Anwendung auf den Haaren ablagern.',
  siloxane: 'Zyklisches Silikon, das in der Umwelt kaum abgebaut wird und sich anreichert. In der EU in abwaschbaren Produkten seit 2020 begrenzt.',
  mineral: 'Bestandteil aus Erdöl, der die Haut abdeckt statt sie zu pflegen. Kann Rückstände von aromatischen Mineralölkohlenwasserstoffen (MOAH) enthalten.',
  peg: 'PEG-Verbindungen können die Haut durchlässiger machen. Bei der Herstellung kann 1,4-Dioxan als Verunreinigung entstehen.',
  alu: 'Aluminiumsalz, das Schweißdrüsen verengt. Laut SCCS in den üblichen Mengen sicher, viele Menschen meiden es trotzdem.',
  alcohol: 'Vergällter Alkohol kann die Haut austrocknen, vor allem bei häufiger Anwendung.',
  edta: 'Komplexbildner, der in der Umwelt schlecht abbaubar ist. Für die Haut gilt er als unproblematisch.',
  tea: 'Kann mit anderen Stoffen Nitrosamine bilden, die als krebserregend gelten. In der EU deshalb begrenzt.',
  pg: 'Feuchthaltemittel, das bei empfindlicher Haut reizen kann.',
  uvok: 'Zugelassener UV-Filter, in der erlaubten Menge laut SCCS sicher.',
  uv_hormon: 'UV-Filter mit Verdacht auf hormonelle Wirkung. Die EU hat die erlaubte Menge 2022 deutlich gesenkt.',
  octo: 'UV-Filter, der zu Benzophenon zerfallen kann und Allergien auslösen kann. Die EU hat die Menge 2022 begrenzt.',
  bp3: 'UV-Filter mit Verdacht auf hormonelle Wirkung, der in der Umwelt Korallen schädigen kann. Die EU hat die erlaubte Menge 2022 stark gesenkt.',
  mbc: 'UV-Filter mit Verdacht auf hormonelle Wirkung. Die SCCS konnte seine Sicherheit 2022 nicht bestätigen.',
  microplastic: 'Fester Kunststoff (Mikroplastik), der über das Abwasser in die Umwelt gelangt. Die EU verbietet absichtlich zugesetztes Mikroplastik schrittweise ab 2023.',
  liqpoly: 'Synthetisches Polymer, das in der Umwelt schwer abbaubar ist. Für die Haut gilt es als unproblematisch.',
  talc: 'Bei Puder kann Talk eingeatmet werden, früher gab es Funde von Asbest-Verunreinigungen. Die IARC stuft Talk seit 2024 als wahrscheinlich krebserregend ein.',
  tio2cos: 'Als Pulver oder Spray kann Titandioxid eingeatmet werden und ist dann als möglicherweise krebserregend eingestuft. In Cremes gilt es als unproblematisch.',
  lanolin: 'Wollwachs pflegt gut, kann aber bei manchen Menschen Allergien auslösen.',
  bhtcos: 'Antioxidans, laut SCCS in Kosmetik bis 0,8 % sicher. Es besteht ein geringer Verdacht auf hormonelle Wirkung.',
  retinol: 'Vitamin A wirkt gegen Falten, kann aber die Haut reizen. Die EU begrenzt seit 2024 die Menge, weil auch über Lebensmittel viel aufgenommen wird.',
  salicyl: 'Wirkt gegen Unreinheiten, kann aber die Haut reizen. Nicht für Produkte für Kinder unter drei Jahren (außer Shampoo).',
  hairdye: 'Haarfarbstoff, der starke Kontaktallergien auslösen kann. Die Packung muss deshalb warnen.',
  hydroq: 'In Kosmetik in der EU verboten (außer künstliche Nägel), weil er die Haut schädigen kann.',
  musk: 'Synthetischer Moschusduft, der sich im Fettgewebe und in der Umwelt anreichern kann.',
  colorok: 'Mineralischer oder zugelassener Farbstoff. Es sind keine besonderen Bedenken bekannt.',
};

// Lebensmittel-Zusatzstoffe: [E-Nummer, Name(n) ; getrennt, Stufe, Begründung, Quelle, Funktion (optional)]
const ADD = [
  ['E100', 'Kurkumin', 0, 'nat'], ['E101', 'Riboflavin;Riboflavin-5-phosphat', 0, 'nat'],
  ['E102', 'Tartrazin', 2, 'south', 'south'], ['E104', 'Chinolingelb', 2, 'south', 'south'], ['E110', 'Gelborange S;Sunset Yellow', 2, 'south', 'south'],
  ['E120', 'Karmin;Echtes Karmin;Cochenille;Karminsäure', 1, 'carmin'], ['E122', 'Azorubin;Carmoisin', 2, 'south', 'south'],
  ['E123', 'Amaranth', 2, 'azo'], ['E124', 'Cochenillerot A;Ponceau 4R', 2, 'south', 'south'], ['E127', 'Erythrosin', 2, 'azo'],
  ['E129', 'Allurarot AC;Allura Red', 2, 'south', 'south'], ['E131', 'Patentblau V', 1, 'azo'], ['E132', 'Indigotin;Indigokarmin', 1, 'azo'],
  ['E133', 'Brillantblau FCF', 1, 'azo'], ['E140', 'Chlorophyll;Chlorophylline', 0, 'nat'], ['E141', 'Kupferkomplexe der Chlorophylle', 0, 'ok'],
  ['E142', 'Grün S', 1, 'azo'], ['E150a', 'Zuckerkulör;Einfaches Zuckerkulör', 0, 'ok'], ['E150b', 'Sulfitlaugen-Zuckerkulör', 1, 'ok'],
  ['E150c', 'Ammoniak-Zuckerkulör', 2, 'caramel'], ['E150d', 'Ammonsulfit-Zuckerkulör', 2, 'caramel'], ['E151', 'Brillantschwarz BN', 1, 'azo'],
  ['E153', 'Pflanzenkohle', 0, 'ok'], ['E155', 'Braun HT', 1, 'azo'], ['E160a', 'Carotin;Beta-Carotin;Carotine', 0, 'nat'],
  ['E160b', 'Annatto;Bixin;Norbixin', 1, 'annatto'], ['E160c', 'Paprikaextrakt;Capsanthin', 0, 'nat'], ['E160d', 'Lycopin', 0, 'nat'],
  ['E160e', 'Beta-apo-8-Carotinal', 0, 'ok'], ['E161b', 'Lutein', 0, 'nat'], ['E162', 'Beetenrot;Betanin', 0, 'nat'], ['E163', 'Anthocyane', 0, 'nat'],
  ['E170', 'Calciumcarbonat', 0, 'ok'], ['E171', 'Titandioxid', 3, 'tio2food', 'tio2'], ['E172', 'Eisenoxide;Eisenhydroxide', 0, 'ok'],
  ['E173', 'Aluminium', 2, 'aluminium'], ['E174', 'Silber', 1, 'ok'], ['E175', 'Gold', 0, 'ok'],
  ['E200', 'Sorbinsäure', 0, 'ok'], ['E202', 'Kaliumsorbat', 0, 'ok'], ['E203', 'Calciumsorbat', 0, 'ok'],
  ['E210', 'Benzoesäure', 1, 'benzoate'], ['E211', 'Natriumbenzoat', 1, 'benzoate'], ['E212', 'Kaliumbenzoat', 1, 'benzoate'], ['E213', 'Calciumbenzoat', 1, 'benzoate'],
  ['E214', 'PHB-Ethylester;Ethyl-p-hydroxybenzoat', 2, 'paraben'], ['E215', 'PHB-Ethylester-Natriumsalz', 2, 'paraben'],
  ['E218', 'PHB-Methylester;Methyl-p-hydroxybenzoat', 2, 'paraben'], ['E219', 'PHB-Methylester-Natriumsalz', 2, 'paraben'],
  ['E220', 'Schwefeldioxid;Schwefeldioxyd', 2, 'sulfite'], ['E221', 'Natriumsulfit', 2, 'sulfite'], ['E222', 'Natriumhydrogensulfit;Natriumbisulfit', 2, 'sulfite'],
  ['E223', 'Natriummetabisulfit;Natriumdisulfit', 2, 'sulfite'], ['E224', 'Kaliummetabisulfit;Kaliumdisulfit', 2, 'sulfite'],
  ['E226', 'Calciumsulfit', 2, 'sulfite'], ['E227', 'Calciumhydrogensulfit', 2, 'sulfite'], ['E228', 'Kaliumhydrogensulfit', 2, 'sulfite'],
  ['E234', 'Nisin', 0, 'ok'], ['E235', 'Natamycin', 1, 'natamycin'], ['E239', 'Hexamethylentetramin', 3, 'formaldf'], ['E242', 'Dimethyldicarbonat', 1, 'ok'],
  ['E249', 'Kaliumnitrit', 3, 'nitrite'], ['E250', 'Natriumnitrit;Nitritpökelsalz', 3, 'nitrite'], ['E251', 'Natriumnitrat', 2, 'nitrate'], ['E252', 'Kaliumnitrat;Salpeter', 2, 'nitrate'],
  ['E260', 'Essigsäure', 0, 'ok'], ['E261', 'Kaliumacetat', 0, 'ok'], ['E262', 'Natriumacetat;Natriumdiacetat', 0, 'ok'], ['E263', 'Calciumacetat', 0, 'ok'],
  ['E270', 'Milchsäure', 0, 'ok'], ['E280', 'Propionsäure', 0, 'ok'], ['E281', 'Natriumpropionat', 0, 'ok'], ['E282', 'Calciumpropionat', 0, 'ok'], ['E283', 'Kaliumpropionat', 0, 'ok'],
  ['E284', 'Borsäure', 2, 'ok'], ['E290', 'Kohlendioxid;Kohlensäure', 0, 'ok', null, 'Kohlensäure'], ['E296', 'Äpfelsäure', 0, 'ok'], ['E297', 'Fumarsäure', 0, 'ok'],
  ['E300', 'Ascorbinsäure;Vitamin C', 0, 'ok'], ['E301', 'Natriumascorbat', 0, 'ok'], ['E302', 'Calciumascorbat', 0, 'ok'], ['E304', 'Ascorbylpalmitat;Ascorbylstearat', 0, 'ok'],
  ['E306', 'Tocopherol;tocopherolhaltige Extrakte;Vitamin E', 0, 'ok'], ['E307', 'Alpha-Tocopherol', 0, 'ok'], ['E308', 'Gamma-Tocopherol', 0, 'ok'], ['E309', 'Delta-Tocopherol', 0, 'ok'],
  ['E310', 'Propylgallat', 2, 'gallate'], ['E311', 'Octylgallat', 2, 'gallate'], ['E312', 'Dodecylgallat', 2, 'gallate'],
  ['E315', 'Isoascorbinsäure;Erythorbinsäure', 0, 'ok'], ['E316', 'Natriumisoascorbat;Natriumerythorbat', 0, 'ok'],
  ['E319', 'TBHQ;tert-Butylhydrochinon', 2, 'tbhq'], ['E320', 'BHA;Butylhydroxyanisol', 3, 'bha'], ['E321', 'BHT;Butylhydroxytoluol', 2, 'bht'],
  ['E322', 'Lecithin;Lecithine;Sojalecithin;Sonnenblumenlecithin;Rapslecithin', 0, 'ok', null, 'Emulgator'],
  ['E325', 'Natriumlactat', 0, 'ok'], ['E326', 'Kaliumlactat', 0, 'ok'], ['E327', 'Calciumlactat', 0, 'ok'],
  ['E330', 'Citronensäure;Zitronensäure', 0, 'ok', null, 'Säuerungsmittel'], ['E331', 'Natriumcitrat;Natriumcitrate', 0, 'ok'], ['E332', 'Kaliumcitrat;Kaliumcitrate', 0, 'ok'], ['E333', 'Calciumcitrat;Calciumcitrate', 0, 'ok'],
  ['E334', 'Weinsäure', 0, 'ok'], ['E335', 'Natriumtartrat', 0, 'ok'], ['E336', 'Kaliumtartrat;Weinstein', 0, 'ok'],
  ['E338', 'Phosphorsäure;Orthophosphorsäure', 1, 'phosphate'], ['E339', 'Natriumphosphat;Natriumphosphate;Dinatriumphosphat', 1, 'phosphate'], ['E340', 'Kaliumphosphat;Kaliumphosphate', 1, 'phosphate'],
  ['E341', 'Calciumphosphat;Calciumphosphate', 1, 'phosphate'], ['E343', 'Magnesiumphosphat;Magnesiumphosphate', 1, 'phosphate'],
  ['E350', 'Natriummalat', 0, 'ok'], ['E351', 'Kaliummalat', 0, 'ok'], ['E352', 'Calciummalat', 0, 'ok'], ['E392', 'Rosmarinextrakt;Extrakt aus Rosmarin', 0, 'nat'],
  ['E400', 'Alginsäure', 0, 'ok'], ['E401', 'Natriumalginat', 0, 'ok'], ['E402', 'Kaliumalginat', 0, 'ok'], ['E404', 'Calciumalginat', 0, 'ok'], ['E405', 'Propylenglycolalginat', 0, 'ok'],
  ['E406', 'Agar-Agar;Agar', 0, 'nat'], ['E407', 'Carrageen;Carrageenan', 1, 'carrageenan'], ['E407a', 'Verarbeitete Eucheuma-Algen', 1, 'carrageenan'],
  ['E410', 'Johannisbrotkernmehl', 0, 'nat'], ['E412', 'Guarkernmehl', 0, 'nat'], ['E413', 'Traganth', 0, 'nat'], ['E414', 'Gummi arabicum;Akaziengummi', 0, 'nat'],
  ['E415', 'Xanthan;Xanthangummi;Xanthan Gum', 0, 'ok'], ['E416', 'Karaya', 0, 'ok'], ['E417', 'Tarakernmehl', 0, 'nat'], ['E418', 'Gellan;Gellangummi', 0, 'ok'],
  ['E420', 'Sorbit;Sorbitol;Sorbitsirup', 1, 'polyol'], ['E421', 'Mannit;Mannitol', 1, 'polyol'], ['E422', 'Glycerin', 0, 'ok'], ['E425', 'Konjak;Konjakgummi', 0, 'ok'],
  ['E432', 'Polysorbat 20', 1, 'emuls'], ['E433', 'Polysorbat 80', 1, 'emuls'], ['E434', 'Polysorbat 40', 1, 'emuls'], ['E435', 'Polysorbat 60', 1, 'emuls'], ['E436', 'Polysorbat 65', 1, 'emuls'],
  ['E440', 'Pektin;Pektine;Amidiertes Pektin', 0, 'nat'], ['E442', 'Ammoniumphosphatide', 1, 'emuls'],
  ['E450', 'Diphosphat;Diphosphate;Natriumdiphosphat', 1, 'phosphate'], ['E451', 'Triphosphat;Triphosphate', 1, 'phosphate'], ['E452', 'Polyphosphat;Polyphosphate', 1, 'phosphate'],
  ['E460', 'Cellulose;Mikrokristalline Cellulose;Cellulosepulver', 0, 'ok'], ['E461', 'Methylcellulose', 0, 'ok'], ['E463', 'Hydroxypropylcellulose', 0, 'ok'], ['E464', 'Hydroxypropylmethylcellulose', 0, 'ok'],
  ['E466', 'Carboxymethylcellulose;Natriumcarboxymethylcellulose;Cellulosegummi', 1, 'emuls'],
  ['E471', 'Mono- und Diglyceride von Speisefettsäuren;Mono und Diglyceride', 0, 'ok', null, 'Emulgator'],
  ['E472a', 'Essigsäureester der Mono- und Diglyceride', 0, 'ok'], ['E472b', 'Milchsäureester der Mono- und Diglyceride', 0, 'ok'], ['E472c', 'Citronensäureester der Mono- und Diglyceride', 0, 'ok'],
  ['E472e', 'Mono- und Diacetylweinsäureester', 0, 'ok'], ['E473', 'Zuckerester von Speisefettsäuren', 1, 'emuls'], ['E475', 'Polyglycerinester von Speisefettsäuren', 0, 'ok'],
  ['E476', 'Polyglycerin-Polyricinoleat;PGPR', 1, 'emuls'], ['E481', 'Natriumstearoyl-2-lactylat', 0, 'ok'], ['E482', 'Calciumstearoyl-2-lactylat', 0, 'ok'],
  ['E491', 'Sorbitanmonostearat', 1, 'emuls'], ['E492', 'Sorbitantristearat', 1, 'emuls'],
  ['E500', 'Natriumcarbonat;Natron;Natriumhydrogencarbonat;Natriumcarbonate', 0, 'ok', null, 'Backtriebmittel'], ['E501', 'Kaliumcarbonat;Kaliumcarbonate', 0, 'ok'],
  ['E503', 'Ammoniumcarbonat;Hirschhornsalz;Ammoniumcarbonate', 0, 'ok'], ['E504', 'Magnesiumcarbonat', 0, 'ok'], ['E507', 'Salzsäure', 0, 'ok'], ['E508', 'Kaliumchlorid', 0, 'ok'],
  ['E509', 'Calciumchlorid', 0, 'ok'], ['E516', 'Calciumsulfat', 0, 'ok'], ['E524', 'Natriumhydroxid;Natronlauge', 0, 'ok'],
  ['E541', 'Saures Natriumaluminiumphosphat', 2, 'aluminium'], ['E551', 'Siliciumdioxid;Kieselsäure', 1, 'silica'], ['E553b', 'Talkum', 0, 'ok'],
  ['E554', 'Natriumaluminiumsilikat', 2, 'aluminium'], ['E570', 'Fettsäuren;Stearinsäure', 0, 'ok'], ['E575', 'Glucono-delta-Lacton', 0, 'ok'], ['E579', 'Eisen-II-gluconat', 0, 'ok'],
  ['E620', 'Glutaminsäure', 1, 'glutamate'], ['E621', 'Mononatriumglutamat;Natriumglutamat;Glutamat', 1, 'glutamate'], ['E622', 'Monokaliumglutamat', 1, 'glutamate'],
  ['E627', 'Dinatriumguanylat;Guanylat', 1, 'purine'], ['E631', 'Dinatriuminosinat;Inosinat', 1, 'purine'], ['E635', 'Dinatrium-5-ribonucleotid;Ribonucleotide', 1, 'purine'],
  ['E900', 'Dimethylpolysiloxan', 0, 'ok'], ['E901', 'Bienenwachs', 0, 'ok'], ['E903', 'Carnaubawachs', 0, 'ok'], ['E904', 'Schellack', 0, 'ok'], ['E920', 'L-Cystein', 0, 'ok'],
  ['E938', 'Argon', 0, 'ok'], ['E941', 'Stickstoff', 0, 'ok'], ['E942', 'Distickstoffmonoxid', 0, 'ok'], ['E948', 'Sauerstoff', 0, 'ok'],
  ['E950', 'Acesulfam K;Acesulfam-K;Acesulfam', 1, 'sweet'], ['E951', 'Aspartam', 2, 'aspartame', 'aspartame'], ['E952', 'Cyclamat;Natriumcyclamat;Cyclamate', 1, 'sweet'],
  ['E953', 'Isomalt', 1, 'polyol'], ['E954', 'Saccharin;Natriumsaccharin', 1, 'sweet'], ['E955', 'Sucralose', 1, 'sweet'], ['E957', 'Thaumatin', 0, 'ok'],
  ['E959', 'Neohesperidin DC', 0, 'ok'], ['E960', 'Steviolglycoside;Steviolglycoside aus Stevia;Stevia', 0, 'ok'], ['E961', 'Neotam', 1, 'sweet'], ['E962', 'Aspartam-Acesulfam-Salz', 2, 'aspartame', 'aspartame'],
  ['E965', 'Maltit;Maltitol;Maltitsirup', 1, 'polyol'], ['E966', 'Lactit;Lactitol', 1, 'polyol'], ['E967', 'Xylit;Xylitol', 1, 'polyol'], ['E968', 'Erythrit;Erythritol', 1, 'polyol'],
  ['E1105', 'Lysozym', 1, 'egg'], ['E1200', 'Polydextrose', 0, 'ok'], ['E1404', 'Oxidierte Stärke', 0, 'ok'], ['E1412', 'Distärkephosphat', 0, 'ok'],
  ['E1414', 'Acetyliertes Distärkephosphat', 0, 'ok'], ['E1420', 'Acetylierte Stärke', 0, 'ok'], ['E1422', 'Acetyliertes Distärkeadipat', 0, 'ok'],
  ['E1442', 'Hydroxypropyldistärkephosphat', 0, 'ok'], ['E1450', 'Stärkenatriumoctenylsuccinat', 0, 'ok'], ['E1505', 'Triethylcitrat', 0, 'ok'], ['E1520', 'Propylenglykol;Propan-1,2-diol', 0, 'ok'],
];
const ADD_FN = (n) => (n < 200 ? 'Farbstoff' : n < 300 ? 'Konservierungsstoff' : n < 400 ? 'Antioxidationsmittel / Säureregulator' : n < 500 ? 'Verdickungsmittel / Emulgator' : n < 600 ? 'Säureregulator / Trägerstoff' : n < 700 ? 'Geschmacksverstärker' : n < 950 ? 'Überzugsmittel / Gas' : n < 1000 ? 'Süßungsmittel' : 'Sonstiger Zusatzstoff');

// Lebensmittel-Zutaten mit eigener Einstufung (keine Zusatzstoffe)
const FOODX = [
  ['palm', 'Palmöl;Palmfett;Palmkernöl;Palmkernfett;pflanzliches Fett (Palm);Palmstearin;Palmolein', 2, 'palm', 'Fett'],
  ['trans', 'teilweise gehärtet;gehärtetes Fett;gehärtete pflanzliche Fette;teilweise gehärtetes Pflanzenfett', 2, 'trans', 'Fett'],
];

// Kosmetik: [INCI-Name(n) ; getrennt, Stufe, Begründung, Funktion, Quelle]
const COS = [
  ['Aqua;Water;Eau;Wasser', 0, 'c_ok', 'Lösungsmittel'], ['Glycerin;Glycerol', 0, 'c_ok', 'Feuchthaltemittel'], ['Panthenol;D-Panthenol;Dexpanthenol', 0, 'c_ok', 'Pflegestoff'],
  ['Tocopherol', 0, 'c_ok', 'Antioxidans'], ['Tocopheryl Acetate', 0, 'c_ok', 'Antioxidans'], ['Aloe Barbadensis Leaf Juice;Aloe Barbadensis Leaf Extract;Aloe Vera', 0, 'c_ok', 'Pflegestoff'],
  ['Sodium Chloride', 0, 'c_ok', 'Verdicker'], ['Citric Acid', 0, 'c_ok', 'pH-Regler'], ['Lactic Acid', 0, 'c_ok', 'pH-Regler'], ['Sodium Citrate', 0, 'c_ok', 'pH-Regler'],
  ['Sodium Hydroxide', 0, 'c_ok', 'pH-Regler'], ['Sodium Benzoate', 0, 'c_ok', 'Konservierer'], ['Potassium Sorbate', 0, 'c_ok', 'Konservierer'], ['Sorbic Acid', 0, 'c_ok', 'Konservierer'],
  ['Benzoic Acid', 0, 'c_ok', 'Konservierer'], ['Dehydroacetic Acid;Sodium Dehydroacetate', 0, 'c_ok', 'Konservierer'], ['Xanthan Gum', 0, 'c_ok', 'Verdicker'],
  ['Cetearyl Alcohol', 0, 'c_ok', 'Konsistenzgeber'], ['Cetyl Alcohol', 0, 'c_ok', 'Konsistenzgeber'], ['Stearyl Alcohol', 0, 'c_ok', 'Konsistenzgeber'],
  ['Glyceryl Stearate;Glyceryl Stearate SE', 0, 'c_ok', 'Emulgator'], ['Glyceryl Oleate', 0, 'c_ok', 'Rückfetter'], ['Glycol Distearate', 0, 'c_ok', 'Perlglanz'],
  ['Coco-Glucoside', 0, 'c_mild', 'Tensid'], ['Decyl Glucoside', 0, 'c_mild', 'Tensid'], ['Lauryl Glucoside', 0, 'c_mild', 'Tensid'],
  ['Sodium Cocoyl Glutamate', 0, 'c_mild', 'Tensid'], ['Disodium Cocoyl Glutamate', 0, 'c_mild', 'Tensid'], ['Sodium Lauroyl Sarcosinate', 0, 'c_mild', 'Tensid'],
  ['Sodium Cocoyl Isethionate', 0, 'c_mild', 'Tensid'], ['Disodium Laureth Sulfosuccinate', 0, 'c_mild', 'Tensid'], ['Sodium Coco-Sulfate', 1, 'sls', 'Tensid'],
  ['Cocamidopropyl Betaine', 1, 'cab', 'Tensid'], ['Coco-Betaine', 0, 'c_mild', 'Tensid'], ['Sodium Lactate', 0, 'c_ok', 'Feuchthaltemittel'], ['Urea', 0, 'c_ok', 'Feuchthaltemittel'],
  ['Allantoin', 0, 'c_ok', 'Pflegestoff'], ['Bisabolol', 0, 'c_ok', 'Pflegestoff'], ['Sodium Hyaluronate;Hyaluronic Acid', 0, 'c_ok', 'Feuchthaltemittel'], ['Niacinamide', 0, 'c_ok', 'Pflegestoff'],
  ['Caprylic/Capric Triglyceride', 0, 'c_oil', 'Rückfetter'], ['Butyrospermum Parkii Butter;Shea Butter', 0, 'c_oil', 'Pflegestoff'], ['Simmondsia Chinensis Seed Oil;Jojoba Oil', 0, 'c_oil', 'Pflegestoff'],
  ['Helianthus Annuus Seed Oil', 0, 'c_oil', 'Pflegestoff'], ['Prunus Amygdalus Dulcis Oil', 0, 'c_oil', 'Pflegestoff'], ['Olea Europaea Fruit Oil', 0, 'c_oil', 'Pflegestoff'],
  ['Cocos Nucifera Oil', 0, 'c_oil', 'Pflegestoff'], ['Argania Spinosa Kernel Oil', 0, 'c_oil', 'Pflegestoff'], ['Squalane', 0, 'c_oil', 'Pflegestoff'],
  ['Zinc Oxide', 0, 'uvok', 'UV-Filter'], ['Kaolin', 0, 'c_ok', 'Füllstoff'], ['Sodium Bicarbonate', 0, 'c_ok', 'pH-Regler'], ['Betaine', 0, 'c_ok', 'Feuchthaltemittel'],
  ['Inulin', 0, 'c_ok', 'Pflegestoff'], ['Glucose', 0, 'c_ok', 'Feuchthaltemittel'], ['Sodium Gluconate', 0, 'c_ok', 'Komplexbildner'], ['Tetrasodium Glutamate Diacetate', 0, 'c_ok', 'Komplexbildner'],
  ['Caprylyl Glycol', 0, 'c_ok', 'Feuchthaltemittel'], ['Ethylhexylglycerin', 0, 'c_ok', 'Konservierungshilfe'], ['1,2-Hexanediol', 0, 'c_ok', 'Feuchthaltemittel'],
  ['Pentylene Glycol', 0, 'c_ok', 'Feuchthaltemittel'], ['Propanediol', 0, 'c_ok', 'Feuchthaltemittel'], ['Butylene Glycol', 0, 'c_ok', 'Feuchthaltemittel'],
  ['Polyquaternium-10', 0, 'c_ok', 'Konditionierer'], ['Guar Hydroxypropyltrimonium Chloride', 0, 'c_ok', 'Konditionierer'], ['Hydrolyzed Wheat Protein', 0, 'c_ok', 'Pflegestoff'],
  ['Behentrimonium Chloride', 1, 'c_ok', 'Konditionierer'], ['Cetrimonium Chloride', 1, 'c_ok', 'Konditionierer'], ['Hydroxyethylcellulose', 0, 'c_ok', 'Verdicker'],
  ['Sodium PCA', 0, 'c_ok', 'Feuchthaltemittel'], ['Ceramide NP', 0, 'c_ok', 'Pflegestoff'], ['Silica', 0, 'c_ok', 'Füllstoff'], ['Mica', 0, 'colorok', 'Farbpigment'],
  ['CI 77491;CI 77492;CI 77499;Iron Oxides', 0, 'colorok', 'Farbpigment'],
  ['CI 77891;Titanium Dioxide', 1, 'tio2cos', 'Farbpigment / UV-Filter', 'sccs'],
  ['Propylene Glycol', 1, 'pg', 'Feuchthaltemittel'], ['Salicylic Acid', 1, 'salicyl', 'Wirkstoff', 'kvo'],
  ['Retinol;Retinyl Palmitate;Retinyl Acetate', 1, 'retinol', 'Wirkstoff', 'sccs'],
  ['Lanolin;Lanolin Alcohol', 1, 'lanolin', 'Rückfetter'], ['Talc', 1, 'talc', 'Füllstoff'],
  ['Parfum;Fragrance;Aroma;Parfüm', 1, 'fragr', 'Duftstoff'],
  ['Linalool', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Limonene;d-Limonene', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Citronellol', 1, 'fallerg', 'Duftstoff', 'kvo'],
  ['Geraniol', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Coumarin', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Eugenol', 1, 'fallerg', 'Duftstoff', 'kvo'],
  ['Hexyl Cinnamal', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Benzyl Alcohol', 1, 'fallerg', 'Duftstoff / Konservierer', 'kvo'], ['Benzyl Salicylate', 1, 'fallerg', 'Duftstoff', 'kvo'],
  ['Benzyl Benzoate', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Benzyl Cinnamate', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Citral', 1, 'fallerg', 'Duftstoff', 'kvo'],
  ['Farnesol', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Alpha-Isomethyl Ionone', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Amyl Cinnamal', 1, 'fallerg', 'Duftstoff', 'kvo'],
  ['Amylcinnamyl Alcohol', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Anise Alcohol', 1, 'fallerg', 'Duftstoff', 'kvo'], ['Cinnamyl Alcohol', 1, 'fallerg', 'Duftstoff', 'kvo'],
  ['Isoeugenol', 2, 'fstrong', 'Duftstoff', 'kvo'], ['Cinnamal', 2, 'fstrong', 'Duftstoff', 'kvo'],
  ['Evernia Prunastri Extract;Oakmoss Extract', 2, 'fstrong', 'Duftstoff', 'kvo'], ['Evernia Furfuracea Extract;Treemoss Extract', 2, 'fstrong', 'Duftstoff', 'kvo'],
  ['Butylphenyl Methylpropional;Lilial', 3, 'fban', 'Duftstoff', 'cmr'], ['Hydroxyisohexyl 3-Cyclohexene Carboxaldehyde;Lyral', 3, 'fban', 'Duftstoff', 'kvo'],
  ['Musk Ketone', 2, 'musk', 'Duftstoff'], ['Galaxolide;Hexamethylindanopyran', 2, 'musk', 'Duftstoff'],
  ['Phenoxyethanol', 1, 'phenoxy', 'Konservierer', 'sccs'], ['Methylparaben', 1, 'paraben_ok', 'Konservierer', 'parab'], ['Ethylparaben', 1, 'paraben_ok', 'Konservierer', 'parab'],
  ['Propylparaben', 3, 'paraben_bad', 'Konservierer', 'parab'], ['Butylparaben', 3, 'paraben_bad', 'Konservierer', 'parab'],
  ['Isopropylparaben;Isobutylparaben;Phenylparaben;Benzylparaben;Pentylparaben', 3, 'paraben_ban', 'Konservierer', 'parab'],
  ['Methylisothiazolinone', 3, 'mit', 'Konservierer', 'mit'], ['Methylchloroisothiazolinone', 3, 'mit', 'Konservierer', 'mit'],
  ['DMDM Hydantoin', 3, 'formald', 'Konservierer', 'form'], ['Imidazolidinyl Urea', 3, 'formald', 'Konservierer', 'form'], ['Diazolidinyl Urea', 3, 'formald', 'Konservierer', 'form'],
  ['Quaternium-15', 3, 'formald', 'Konservierer', 'form'], ['Sodium Hydroxymethylglycinate', 3, 'formald', 'Konservierer', 'form'],
  ['2-Bromo-2-Nitropropane-1,3-Diol;Bronopol', 3, 'formald', 'Konservierer', 'form'], ['5-Bromo-5-Nitro-1,3-Dioxane', 3, 'formald', 'Konservierer', 'form'],
  ['Formaldehyde', 3, 'formald', 'Konservierer', 'form'], ['Triclosan', 3, 'triclosan', 'Antibakterieller Stoff', 'sccs'],
  ['Sodium Laureth Sulfate;SLES;Natriumlaurethsulfat', 1, 'sles', 'Tensid'], ['Ammonium Laureth Sulfate', 1, 'sles', 'Tensid'], ['Magnesium Laureth Sulfate', 1, 'sles', 'Tensid'],
  ['Sodium Lauryl Sulfate;SLS;Natriumlaurylsulfat', 2, 'sls', 'Tensid'], ['Ammonium Lauryl Sulfate', 2, 'sls', 'Tensid'], ['Sodium Myreth Sulfate', 1, 'sles', 'Tensid'],
  ['Dimethicone', 2, 'silicone', 'Silikon'], ['Amodimethicone', 2, 'silicone', 'Silikon'], ['Dimethiconol', 2, 'silicone', 'Silikon'], ['Phenyl Trimethicone', 2, 'silicone', 'Silikon'],
  ['Cetyl Dimethicone', 2, 'silicone', 'Silikon'], ['Trimethylsiloxysilicate', 2, 'silicone', 'Silikon'], ['Cyclohexasiloxane', 2, 'siloxane', 'Silikon', 'silox'],
  ['Cyclopentasiloxane', 3, 'siloxane', 'Silikon', 'silox'], ['Cyclotetrasiloxane', 3, 'siloxane', 'Silikon', 'silox'], ['Cyclomethicone', 3, 'siloxane', 'Silikon', 'silox'],
  ['Paraffinum Liquidum;Mineral Oil', 2, 'mineral', 'Rückfetter'], ['Paraffin', 2, 'mineral', 'Konsistenzgeber'], ['Petrolatum;Vaseline', 2, 'mineral', 'Rückfetter'],
  ['Cera Microcristallina;Microcrystalline Wax', 2, 'mineral', 'Konsistenzgeber'], ['Ozokerite', 2, 'mineral', 'Konsistenzgeber'],
  ['Aluminum Chlorohydrate;Aluminium Chlorohydrate', 1, 'alu', 'Antitranspirant', 'sccs'], ['Aluminum Zirconium Tetrachlorohydrex GLY', 1, 'alu', 'Antitranspirant', 'sccs'],
  ['Alcohol Denat.;Alcohol Denat;Alcohol', 1, 'alcohol', 'Lösungsmittel'], ['Disodium EDTA', 1, 'edta', 'Komplexbildner'], ['Tetrasodium EDTA', 1, 'edta', 'Komplexbildner'],
  ['BHT', 1, 'bhtcos', 'Antioxidans', 'sccs'], ['Triethanolamine;TEA', 1, 'tea', 'pH-Regler', 'kvo'],
  ['Ethylhexyl Salicylate', 1, 'uvok', 'UV-Filter'], ['Butyl Methoxydibenzoylmethane;Avobenzone', 1, 'uvok', 'UV-Filter'], ['Bis-Ethylhexyloxyphenol Methoxyphenyl Triazine', 0, 'uvok', 'UV-Filter'],
  ['Ethylhexyl Triazone', 0, 'uvok', 'UV-Filter'], ['Diethylamino Hydroxybenzoyl Hexyl Benzoate', 0, 'uvok', 'UV-Filter'],
  ['Octocrylene', 2, 'octo', 'UV-Filter', 'uv'], ['Homosalate', 2, 'uv_hormon', 'UV-Filter', 'uv'], ['Ethylhexyl Methoxycinnamate;Octinoxate', 2, 'uv_hormon', 'UV-Filter', 'sccs'],
  ['Benzophenone-3;Oxybenzone', 3, 'bp3', 'UV-Filter', 'uv'], ['Benzophenone-4', 1, 'uvok', 'UV-Filter'], ['4-Methylbenzylidene Camphor', 3, 'mbc', 'UV-Filter', 'sccs'],
  ['Polyethylene', 3, 'microplastic', 'Kunststoff', 'micro'], ['Polypropylene', 3, 'microplastic', 'Kunststoff', 'micro'], ['Nylon-12', 3, 'microplastic', 'Kunststoff', 'micro'],
  ['Nylon-6', 3, 'microplastic', 'Kunststoff', 'micro'], ['Polymethyl Methacrylate', 3, 'microplastic', 'Kunststoff', 'micro'], ['Polyethylene Terephthalate', 3, 'microplastic', 'Kunststoff (Glitzer)', 'micro'],
  ['Acrylates Copolymer', 2, 'liqpoly', 'Kunststoff'], ['Acrylates/C10-30 Alkyl Acrylate Crosspolymer', 2, 'liqpoly', 'Kunststoff'], ['Carbomer', 1, 'liqpoly', 'Verdicker'],
  ['Polyquaternium-7', 1, 'liqpoly', 'Konditionierer'], ['Polyacrylamide', 2, 'liqpoly', 'Kunststoff'], ['VP/VA Copolymer', 1, 'liqpoly', 'Filmbildner'],
  ['Hydroquinone', 3, 'hydroq', 'Aufheller', 'kvo'], ['p-Phenylenediamine;PPD', 3, 'hairdye', 'Haarfarbe', 'kvo'], ['Toluene-2,5-Diamine;Toluene-2,5-Diamine Sulfate', 2, 'hairdye', 'Haarfarbe', 'kvo'],
  ['Resorcinol', 2, 'hairdye', 'Haarfarbe', 'kvo'],
];

// PEG-/PPG-/Ceteareth-Verbindungen werden über ein Muster erkannt
const PATTERNS = [
  [/^(peg|ppg)-?\d+/i, { level: 1, r: 'peg', fn: 'Emulgator / Tensid', kind: 'cos', src: 'cosing' }],
  [/^(ceteareth|laureth|steareth|oleth)-?\d+/i, { level: 1, r: 'peg', fn: 'Emulgator', kind: 'cos', src: 'cosing' }],
  [/^polysorbate[- ]?\d+/i, { level: 1, r: 'peg', fn: 'Emulgator', kind: 'cos', src: 'cosing' }],
];

const keyOf = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');

// Zwei Tabellen (Lebensmittel, Kosmetik): Schlüssel -> Eintrag. DB enthält beide, Lebensmittel zuerst.
export const DB = new Map();
const DBK = { food: new Map(), cos: new Map() };
const entries = [];
for (const [e, names, level, r, src, fn] of ADD) {
  const num = parseInt(e.slice(1), 10);
  const list = names.split(';');
  const it = { id: e, e, name: list[0], names: list, level, r, src: src || (r === 'ok' || r === 'nat' ? 'eudb' : 'efsa'), fn: fn || ADD_FN(num), kind: 'food' };
  entries.push(it);
  DB.set(keyOf(e), it); DBK.food.set(keyOf(e), it);
  list.forEach((n) => { DB.set(keyOf(n), it); DBK.food.set(keyOf(n), it); });
}
for (const [id, names, level, r, fn] of FOODX) {
  const list = names.split(';');
  const it = { id, name: list[0], names: list, level, r, src: 'efsa', fn, kind: 'food' };
  entries.push(it);
  list.forEach((n) => { DB.set(keyOf(n), it); DBK.food.set(keyOf(n), it); });
}
for (const [names, level, r, fn, src] of COS) {
  const list = names.split(';');
  const it = { id: 'c:' + keyOf(list[0]), name: list[0], names: list, level, r, src: src || 'cosing', fn, kind: 'cos' };
  entries.push(it);
  list.forEach((n) => { const k = keyOf(n); DBK.cos.set(k, it); if (!DB.has(k)) DB.set(k, it); });
}
export const ALL = entries;
const KEYS = { food: [...DBK.food.keys()].filter((k) => k.length >= 5), cos: [...DBK.cos.keys()].filter((k) => k.length >= 5) };
const getK = (k, kind) => DBK[kind].get(k) || DBK[kind === 'cos' ? 'food' : 'cos'].get(k);

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Zutatenliste in einzelne Stoffe zerlegen
export function splitIngredients(text) {
  let t = String(text || '').replace(/\r/g, ' ').replace(/\n/g, ' ');
  const m = t.match(/(ingredients?|inhaltsstoffe|zutaten|ingr[ée]dients|inci)\s*[:.]/i);
  if (m) t = t.slice(m.index + m[0].length);
  // Ende der Liste (z. B. "Kann Spuren von", "Nährwerte")
  t = t.replace(/(kann spuren|kann enthalten|nährwert|naehrwert|durchschnittliche|mindestens haltbar|zu verbrauchen).*$/i, '');
  return t
    .replace(/\[|\{/g, '(').replace(/\]|\}/g, ')')
    .replace(/[()]/g, ',')
    .split(/[,;•·|]|\s\/\s|\.\s/)
    .map((s) => s.replace(/\*+|\d+(?:[.,]\d+)?\s*%/g, ' ').replace(/^[\s:.\-–]+|[\s:.\-–]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 1 && /[a-zäöüA-ZÄÖÜ]/.test(s));
}

// Einen Stoff in der Liste finden. kind: 'food' oder 'cos'
export function lookup(token, kind) {
  const raw = token.trim();
  const em = raw.match(/\bE\s?-?\s?(\d{3,4}[a-f]?)\b/i);
  if (em) { const it = DBK.food.get(keyOf('E' + em[1])); if (it) return { it, how: 'e' }; }
  if (kind !== 'cos' && kind !== 'food') kind = 'food';
  const k = keyOf(raw.replace(/^(säuerungsmittel|säureregulator|konservierungsstoff|antioxidationsmittel|emulgator|emulgatoren|verdickungsmittel|geliermittel|farbstoff|farbstoffe|stabilisator|stabilisatoren|geschmacksverstärker|süßungsmittel|süssungsmittel|backtriebmittel|trennmittel|überzugsmittel|feuchthaltemittel|modifizierte stärke)\s*:?\s*/i, ''));
  if (!k) return null;
  // Lebensmittel: Wasser usw. sind normale Zutaten, keine Kosmetik-Stoffe
  let it = kind === 'food' ? DBK.food.get(k) : getK(k, kind);
  if (it) return { it, how: 'exact' };
  for (const [re, def] of PATTERNS) if (re.test(raw)) return { it: { id: 'p:' + k, name: raw, names: [raw], ...def }, how: 'pattern' };
  // Teilstring: bekannter Name steckt im Text (z. B. "Säuerungsmittel Citronensäure")
  let best = null;
  for (const key of KEYS[kind]) if (k.includes(key) && (!best || key.length > best.length)) best = key;
  if (best && best.length >= Math.min(8, k.length - 2)) return { it: DBK[kind].get(best), how: 'part' };
  // Lesefehler der Texterkennung tolerieren
  if (k.length >= 6) {
    const max = k.length >= 12 ? 2 : 1;
    let hit = null, d0 = max + 1;
    for (const key of KEYS[kind]) { const d = lev(k, key, max); if (d < d0) { d0 = d; hit = key; } }
    if (hit) return { it: DBK[kind].get(hit), how: 'fuzzy' };
  }
  return null;
}

// Komplette Bewertung: Liste aus Text (und optional E-Nummern aus Open Food Facts)
export function analyze(text, kind, extraE = []) {
  const tokens = splitIngredients(text);
  const out = [], seen = new Set();
  const push = (x) => { const key = x.it ? x.it.id : 'u:' + keyOf(x.name); if (seen.has(key)) return; seen.add(key); out.push(x); };
  for (const tok of tokens) {
    const f = lookup(tok, kind);
    if (f) push({ name: tok, it: f.it, how: f.how });
    else if (kind === 'food' && tok.length <= 40) push({ name: tok, it: { id: 'f:' + keyOf(tok), name: tok, level: 0, r: 'food', fn: 'Zutat', src: null, kind: 'food', plain: true }, how: 'plain' });
    else push({ name: tok, it: null, how: 'none' });
  }
  for (const e of extraE) { const it = DB.get(keyOf(e)); if (it) push({ name: it.name, it, how: 'off' }); else push({ name: e.toUpperCase(), it: null, how: 'none' }); }
  return out;
}

// Nährwert-Ampel nach FSA (Front-of-Pack Guidance), je 100 g bzw. 100 ml
const FSA = {
  food: { fat: [3, 17.5], sat: [1.5, 5], sugar: [5, 22.5], salt: [0.3, 1.5] },
  drink: { fat: [1.5, 8.75], sat: [0.75, 2.5], sugar: [2.5, 11.25], salt: [0.3, 0.75] },
};
export function traffic(n, drink) {
  const T = FSA[drink ? 'drink' : 'food'];
  return ['fat', 'sat', 'sugar', 'salt'].filter((k) => n[k] != null).map((k) => {
    const v = n[k], [lo, hi] = T[k];
    return { k, v, lvl: v <= lo ? 0 : v > hi ? 2 : 1 };
  });
}
