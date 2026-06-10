"""
Russian and English name mappings for PoE2 currencies and items.

Maps api_id (from POE2Scout API) to localized display names.
Used by the backend API to return translated names alongside the api_id.

Sources:
  - Official PoE2 Russian client localization (where confirmed)
  - config.yaml liquid_chain sections (confirmed ru_name values)
  - Best-effort translation for items without official RU client data (# approximate)

Maintainer notes:
  - Entries marked "# approximate" are not verified against the official RU client.
  - When the official RU translation becomes available, remove the # approximate tag.
  - Keep entries sorted by category for maintainability.
"""

# ---------------------------------------------------------------------------
# Category labels
# ---------------------------------------------------------------------------
CATEGORY_NAMES_RU: dict[str, str] = {
    "currency": "Валюта",
    "fragments": "Фрагменты",
    "runes": "Руны",
    "essences": "Сущности",
    "ultimatum": "Ядра душ",
    "expedition": "Монеты экспедиции",
    "ritual": "Омены ритуала",
    "vaultkeys": "Ключи реликвария",
    "breach": "Разлом",
    "abyss": "Бездна",
    "uncutgems": "Неогранённые камни",
    "lineagesupportgems": "Камни поддержки родословной",
    "delirium": "Делирий",
    "incursion": "Вторжение",
    "idol": "Идолы",
    "verisium": "Веризий",
    "vaal": "Ваал",
}

CATEGORY_NAMES_EN: dict[str, str] = {
    "currency": "Currency",
    "fragments": "Fragments",
    "runes": "Runes",
    "essences": "Essences",
    "ultimatum": "Soul Cores",
    "expedition": "Expedition Coinage & Artifacts",
    "ritual": "Ritual Omens",
    "vaultkeys": "Reliquary Keys",
    "breach": "Breach",
    "abyss": "Abyssal Bones",
    "uncutgems": "Uncut Gems",
    "lineagesupportgems": "Lineage Support Gems",
    "delirium": "Delirium",
    "incursion": "Incursion",
    "idol": "Idols",
    "verisium": "Verisium",
    "vaal": "Vaal",
}

# ---------------------------------------------------------------------------
# Item-level mappings  (api_id -> display name)
# ---------------------------------------------------------------------------

CURRENCY_NAMES_RU: dict[str, str] = {
    # ===================================================================
    # CURRENCY  (CategoryApiId: currency)
    # ===================================================================
    "exalted": "Благородная сфера",
    "chaos": "Сфера хаоса",
    "divine": "Божественная сфера",
    "vaal": "Сфера Ваала",
    "mirror": "Зеркало Каландры",
    "alch": "Сфера алхимика",
    "transmute": "Сфера превращения",
    "aug": "Сфера дополнения",
    "chance": "Сфера удачи",
    "annul": "Сфера аннулирования",
    "regal": "Коронованная сфера",
    "whetstone": "Точильный камень кузнеца",
    "scrap": "Кусок брони",
    "bauble": "Стеклодувная бусина",
    "gcp": "Призма резчика камней",
    "etcher": "Травитель мистика",  # approximate
    "artificers": "Сфера механика",
    "wisdom": "Свиток мудрости",
    "fracturing-orb": "Сфера раскалывания",
    "chance-shard": "Осколок удачи",
    "regal-shard": "Осколок коронованной сферы",
    "artificers-shard": "Осколок сферы механика",
    "transmutation-shard": "Осколок сферы превращения",
    "greater-chaos-orb": "Великая сфера хаоса",
    "greater-exalted-orb": "Великая благородная сфера",
    "greater-orb-of-transmutation": "Великая сфера превращения",
    "greater-orb-of-augmentation": "Великая сфера дополнения",
    "greater-regal-orb": "Великая коронованная сфера",
    "greater-jewellers-orb": "Великая сфера ювелира",
    "lesser-jewellers-orb": "Малая сфера ювелира",
    "perfect-chaos-orb": "Идеальная сфера хаоса",
    "perfect-exalted-orb": "Идеальная благородная сфера",
    "perfect-jewellers-orb": "Идеальная сфера ювелира",
    "perfect-orb-of-transmutation": "Идеальная сфера превращения",
    "perfect-orb-of-augmentation": "Идеальная сфера дополнения",
    "perfect-regal-orb": "Идеальная коронованная сфера",
    "cryptic-key": "Таинственный ключ",
    "hinekoras-lock": "Замок Хинекоры",
    "portal": "Свиток портала",  # approximate — standard PoE name
    "identify": "Свиток опознания",  # approximate — standard PoE name
    "scouring": "Сфера очищения",  # approximate — standard PoE name
    "regret": "Сфера сожаления",  # approximate — standard PoE name
    "fusings": "Сфера слияния",  # approximate — standard PoE name
    "chromatic": "Хроматическая сфера",  # approximate — standard PoE name
    "jeweller": "Сфера ювелира",  # approximate — standard PoE name
    "blessed": "Благословенная сфера",  # approximate — standard PoE name
    "eternal": "Вечная сфера",  # approximate — standard PoE name
    "silver": "Серебряная монета",  # approximate — standard PoE name
    "gold": "Золото",
    "perandus": "Монета Перандуса",  # approximate
    "alteration": "Сфера перемен",  # approximate — standard PoE name

    # ===================================================================
    # FRAGMENTS  (CategoryApiId: fragments)
    # ===================================================================
    "raven-touched-shard": "Осколок, тронутый вороном",
    "head-of-the-king": "Голова короля",

    # ===================================================================
    # RUNES  (CategoryApiId: runes)
    # ===================================================================
    "astrids-creativity": "Творчество Астрид",  # approximate
    # PoE2 runes — fire/ice/lightning tiers
    "fire-rune-tier-1": "Огненная руна I уровня",  # approximate
    "fire-rune-tier-2": "Огненная руна II уровня",  # approximate
    "fire-rune-tier-3": "Огненная руна III уровня",  # approximate
    "ice-rune-tier-1": "Ледяная руна I уровня",  # approximate
    "ice-rune-tier-2": "Ледяная руна II уровня",  # approximate
    "ice-rune-tier-3": "Ледяная руна III уровня",  # approximate
    "lightning-rune-tier-1": "Руны молнии I уровня",  # approximate
    "lightning-rune-tier-2": "Руны молнии II уровня",  # approximate
    "lightning-rune-tier-3": "Руны молнии III уровня",  # approximate

    # ===================================================================
    # ESSENCES  (CategoryApiId: essences)
    # ===================================================================
    "essence-of-enfeeblement": "Сущность ослабления",  # approximate
    "essence-of-sorrow": "Сущность печали",  # approximate
    "essence-of-rage": "Сущность ярости",  # approximate
    "essence-of-suffering": "Сущность страдания",  # approximate
    "essence-of-wrath": "Сущность гнева",  # approximate
    "essence-of-doubt": "Сущность сомнения",  # approximate
    "essence-of-anger": "Сущность злости",  # approximate
    "essence-of-torment": "Сущность мучения",  # approximate
    "essence-of-fear": "Сущность страха",  # approximate
    "essence-of-horror": "Сущность ужаса",  # approximate
    "essence-of-delirium": "Сущность безумия",  # approximate
    "essence-of-hysteria": "Сущность истерики",  # approximate
    "essence-of-insanity": "Сущность безумия (великая)",  # approximate
    "deafening-essence-of-enfeeblement": "Оглушающая сущность ослабления",  # approximate
    "deafening-essence-of-sorrow": "Оглушающая сущность печали",  # approximate
    "deafening-essence-of-rage": "Оглушающая сущность ярости",  # approximate
    "deafening-essence-of-suffering": "Оглушающая сущность страдания",  # approximate
    "deafening-essence-of-wrath": "Оглушающая сущность гнева",  # approximate
    "deafening-essence-of-doubt": "Оглушающая сущность сомнения",  # approximate
    "deafening-essence-of-anger": "Оглушающая сущность злости",  # approximate
    "deafening-essence-of-torment": "Оглушающая сущность мучения",  # approximate
    "deafening-essence-of-fear": "Оглушающая сущность страха",  # approximate
    "deafening-essence-of-horror": "Оглушающая сущность ужаса",  # approximate
    "deafening-essence-of-delirium": "Оглушающая сущность безумия",  # approximate
    "deafening-essence-of-hysteria": "Оглушающая сущность истерики",  # approximate
    "deafening-essence-of-insanity": "Оглушающая сущность безумия (великая)",  # approximate
    "life-essence": "Сущность жизни",  # approximate
    "mana-essence": "Сущность маны",  # approximate

    # ===================================================================
    # ULTIMATUM / SOUL CORES  (CategoryApiId: ultimatum)
    # ===================================================================
    "soul-core-of-quipolatl": "Ядро души Киполатля",
    "soul-core-of-azcapa": "Ядро души Ацкапы",
    "soul-core-of-opiloti": "Ядро души Опилоти",
    "soul-core-of-zalatl": "Ядро души Салатля",
    "soul-core-of-cholotl": "Ядро души Чолотля",  # approximate
    "soul-core-of-tacati": "Ядро души Такати",  # approximate
    "soul-core-of-citaqualotl": "Ядро души Ситаквалотля",  # approximate
    "soul-core-of-jiquani": "Ядро души Хиквани",  # approximate
    "soul-core-of-zantipi": "Ядро души Цантипи",  # approximate
    "soul-core-of-ticaba": "Ядро души Тикабы",  # approximate
    "soul-core-of-topotante": "Ядро души Топотанте",  # approximate
    "soul-core-of-xopec": "Ядро души Шопека",  # approximate
    "soul-core-of-atmohua": "Ядро души Атмоуа",  # approximate
    "soul-core-of-tzamoto": "Ядро души Цамото",  # approximate
    "soul-core-of-puhuarte": "Ядро души Пухуарте",  # approximate
    "opilotis-soul-core-of-assault": "Ядро души натиска Опилоти",
    "xopecs-soul-core-of-power": "Ядро души мощи Шопека",
    "quipolatls-soul-core-of-flow": "Ядро души потока Киполатля",  # approximate
    "tzamotos-soul-core-of-ferocity": "Ядро души свирепости Цамото",  # approximate
    "guatelitzis-soul-core-of-endurance": "Ядро души стойкости Гвателици",  # approximate
    "estazuntis-soul-core-of-convalescence": "Ядро души выздоровления Эстазунти",  # approximate
    "xipocados-soul-core-of-dominion": "Ядро души господства Шипокадо",  # approximate
    "tacatis-soul-core-of-affliction": "Ядро души недуга Такати",  # approximate
    "hayoxis-soul-core-of-heatproofing": "Ядро души жароустойчивости Хайокси",  # approximate
    "atmohuas-soul-core-of-retreat": "Ядро души отступления Атмоуа",  # approximate

    # ===================================================================
    # EXPEDITION  (CategoryApiId: expedition)
    # ===================================================================
    "aldurs-saga": "Сага Алдура",
    "olroths-conviction": "Убеждённость Олрота",
    "rigwalds-ferocity": "Свирепость Ригвальда",
    "voranas-siege": "Осада Вораны",
    "gwenithas-gamble": "Азарт Гвенифы",  # approximate
    "medveds-might": "Мощь Медведя",  # approximate
    "tujen-penny": "Пенни Туджена",  # approximate
    "rostas-faith": "Вера Росты",  # approximate
    "ursas-resolution": "Решимость Урсы",  # approximate
    "sukaas-dash": "Рывок Сукаа",  # approximate
    "dannigs-honour": "Честь Даннига",  # approximate
    "kalguur-rune": "Руна Калгура",  # approximate
    "expedition-logbook": "Журнал экспедиции",  # approximate
    "artifact-of-the-chayula": "Артефакт Чаюлы",  # approximate
    "artifact-of-the-vaal": "Артефакт Ваала",  # approximate
    "artifact-of-the-abyss": "Артефакт Бездны",  # approximate
    "artifact-of-the-breach": "Артефакт Разлома",  # approximate
    "sun-touched-helmet": "Солнцеликый шлем",  # approximate
    "sun-touched-armour": "Солнцеликый доспех",  # approximate
    "sun-touched-gloves": "Солнцеликые перчатки",  # approximate
    "sun-touched-boots": "Солнцеликые сапоги",  # approximate
    "sun-touched-weapon": "Солнцеликое оружие",  # approximate

    # ===================================================================
    # RITUAL OMENS  (CategoryApiId: ritual)
    # ===================================================================
    "omen-of-whittling": "Омен вырезывания",
    "omen-of-chance": "Омен шанса",
    "omen-of-light": "Омен света",
    "omen-of-abyssal-echoes": "Омен бездных отголосков",
    "omen-of-amelioration": "Омен улучшения",
    "omen-of-sinistral-erasure": "Омен левого стирания",
    "omen-of-sinistral-annulment": "Омен левого аннулирования",
    "omen-of-dextral-annulment": "Омен правого аннулирования",
    "omen-of-dextral-erasure": "Омен правого стирания",
    "omen-of-sinistral-crystallisation": "Омен левой кристаллизации",
    "omen-of-dextral-crystallisation": "Омен правой кристаллизации",
    "omen-of-sinistral-exaltation": "Омен левого возвышения",
    "omen-of-greater-exaltation": "Омен великого возвышения",
    "omen-of-sanctification": "Омен освящения",
    "omen-of-the-blessed": "Омен благословенных",
    "omen-of-catalysing-exaltation": "Омен катализирующего возвышения",
    "omen-of-the-hunt": "Омен охоты",
    "omen-of-secret-compartments": "Омен тайных отделений",
    "omen-of-reinforcements": "Омен подкрепления",
    "omen-of-answered-prayers": "Омен отвеченных молитв",
    "omen-of-the-ancients": "Омен древних",
    "omen-of-chaotic-quantity": "Омен хаотичного количества",
    "omen-of-chaotic-monsters": "Омен хаотичных монстров",
    "omen-of-chaotic-rarity": "Омен хаотичной редкости",
    "omen-of-chaotic-effectiveness": "Омен хаотичной эффективности",
    "omen-of-sinistral-necromancy": "Омен левой некромантии",
    "omen-of-the-blackblooded": "Омен чернокровных",
    "omen-of-putrefaction": "Омен гниения",
    "omen-of-bartering": "Омен обмена",

    # ===================================================================
    # VAULTKEYS / RELIQUARY KEYS  (CategoryApiId: vaultkeys)
    # ===================================================================
    "twilight-reliquary-key": "Сумеречный ключ реликвария",
    "the-arbiters-reliquary-key": "Ключ реликвария Арбитра",
    "xeshts-reliquary-key": "Ключ реликвария Кшета",
    "ritualistic-reliquary-key": "Ритуалистический ключ реликвария",
    "olroths-reliquary-key": "Ключ реликвария Олрота",
    "the-trialmasters-reliquary-key": "Ключ реликвария Мастера испытаний",
    "against-the-darkness": "Против тьмы",  # approximate
    "tangmazus-reliquary-key": "Ключ реликвария Тангмазу",
    "temporalis": "Времинар",  # approximate — Zarokh's Key: Temporalis

    # ===================================================================
    # BREACH  (CategoryApiId: breach)
    # ===================================================================
    "uul-netols-embrace": "Объятие Уул-Нетола",
    "xophs-blood": "Кровь Ксофа",  # approximate
    "tul-fall": "Падение Тул",  # approximate
    "eshs-breach": "Разлом Эш",  # approximate
    "chayulas-breach": "Разлом Чаюлы",  # approximate
    "splinter-of-uul-netol": "Осколок Уул-Нетола",  # approximate
    "splinter-of-xoph": "Осколок Ксофа",  # approximate
    "splinter-of-tul": "Осколок Тул",  # approximate
    "splinter-of-esh": "Осколок Эш",  # approximate
    "splinter-of-chayula": "Осколок Чаюлы",  # approximate
    "breachstone-of-uul-netol": "Камень разлома Уул-Нетола",  # approximate
    "breachstone-of-xoph": "Камень разлома Ксофа",  # approximate
    "breachstone-of-tul": "Камень разлома Тул",  # approximate
    "breachstone-of-esh": "Камень разлома Эш",  # approximate
    "breachstone-of-chayula": "Камень разлома Чаюлы",  # approximate
    "breach-catalyst-life": "Катализатор разлома: жизнь",  # approximate
    "breach-catalyst-fire": "Катализатор разлома: огонь",  # approximate
    "breach-catalyst-cold": "Катализатор разлома: холод",  # approximate
    "breach-catalyst-lightning": "Катализатор разлома: молния",  # approximate

    # ===================================================================
    # ABYSS  (CategoryApiId: abyss)
    # ===================================================================
    "rakiatas-flow": "Поток Ракиаты",
    "garukhans-resolve": "Решимость Гарухан",
    "astrids-creativity": "Творчество Астрид",
    # Note: "astrids-creativity" also appears under runes category in API data
    "gnawed-jawbone": "Изгрызенная челюсть",  # approximate
    "abyssal-wail": "Бездонный плач",  # approximate
    "stibnite-doom": "Стибнитовая гибель",  # approximate
    "profane-vigor": "Кощунственная сила",  # approximate

    # ===================================================================
    # UNCUT GEMS  (CategoryApiId: uncutgems)
    # ===================================================================
    "uncut-skill-gem": "Неогранённый камень умения",  # approximate
    "uncut-support-gem": "Неогранённый камень поддержки",  # approximate
    "uncut-spirit-gem": "Неогранённый духовный камень",  # approximate

    # ===================================================================
    # LINEAGE SUPPORT GEMS  (CategoryApiId: lineagesupportgems)
    # ===================================================================
    "lineage-lifetap": "Родословная: похищение жизни",  # approximate
    "lineage-omnicurse": "Родословная: всепроклятие",  # approximate
    "lineage-unbound-malice": "Родословная: неограниченная злоба",  # approximate

    # ===================================================================
    # DELIRIUM  (CategoryApiId: delirium)
    # ===================================================================
    # --- Delirium liquids (from config.yaml — confirmed RU names) ---
    "diluted-liquid-ire": "Разбавленный жидкий гнев",
    "diluted-liquid-guilt": "Разбавленная жидкая вина",
    "diluted-liquid-greed": "Разбавленная жидкая жадность",
    "liquid-paranoia": "Жидкая паранойя",
    "liquid-envy": "Жидкая зависть",
    "liquid-disgust": "Жидкое отвращение",
    "liquid-despair": "Жидкое отчаяние",
    "concentrated-liquid-fear": "Концентрированный жидкий страх",
    "concentrated-liquid-suffering": "Концентрированное жидкое страдание",
    "concentrated-liquid-isolation": "Концентрированное жидкое отчуждение",
    # --- Potent liquids (from API data) ---
    "potent-liquid-contempt": "Крепкая жидкость презрения",  # approximate
    "potent-liquid-ferocity": "Крепкая жидкость свирепости",  # approximate
    "potent-liquid-melancholy": "Крепкая жидкость меланхолии",  # approximate
    # --- Ancient variants (from API data) ---
    "ancient-potent-liquid-contempt": "Древняя крепкая жидкость презрения",  # approximate
    "ancient-potent-liquid-ferocity": "Древняя крепкая жидкость свирепости",  # approximate
    "ancient-potent-liquid-melancholy": "Древняя крепкая жидкость меланхолии",  # approximate
    "ancient-concentrated-liquid-isolation": "Древняя концентрированная жидкость отчуждения",  # approximate
    "ancient-concentrated-liquid-fear": "Древний концентрированный жидкий страх",  # approximate
    "ancient-concentrated-liquid-suffering": "Древнее концентрированное жидкое страдание",  # approximate
    "ancient-liquid-despair": "Древняя жидкость отчаяния",  # approximate
    "ancient-liquid-disgust": "Древняя жидкость отвращения",  # approximate
    "ancient-liquid-paranoia": "Древняя жидкость паранойи",  # approximate
    "ancient-liquid-envy": "Древняя жидкость зависти",  # approximate
    "ancient-diluted-liquid-greed": "Древняя разбавленная жидкость жадности",  # approximate
    "ancient-diluted-liquid-guilt": "Древняя разбавленная жидкая вина",  # approximate
    # --- Distilled emotions (common PoE2 delirium items) ---
    "distilled-ire": "Дистиллированный гнев",  # approximate
    "distilled-guilt": "Дистиллированная вина",  # approximate
    "distilled-greed": "Дистиллированная жадность",  # approximate
    "distilled-paranoia": "Дистиллированная паранойя",  # approximate
    "distilled-envy": "Дистиллированная зависть",  # approximate
    "distilled-disgust": "Дистиллированное отвращение",  # approximate
    "distilled-despair": "Дистиллированное отчаяние",  # approximate
    "distilled-fear": "Дистиллированный страх",  # approximate
    "distilled-suffering": "Дистиллированное страдание",  # approximate
    "distilled-isolation": "Дистиллированное отчуждение",  # approximate

    # ===================================================================
    # INCURSION  (CategoryApiId: incursion)
    # ===================================================================
    "call-of-the-shadows": "Зов теней",
    "incursion-greater-vaal-orb": "Великая сфера Ваала вторжения",  # approximate
    "incursion-vaal-orb": "Сфера Ваала вторжения",  # approximate

    # ===================================================================
    # IDOLS  (CategoryApiId: idol)
    # ===================================================================
    "fox-idol": "Идол лисы",
    "rabbit-idol": "Идол кролика",
    "wolf-idol": "Идол волка",
    "ox-idol": "Идол быка",
    "bear-idol": "Идол медведя",
    "boar-idol": "Идол вепря",
    "owl-idol": "Идол совы",
    "cat-idol": "Идол кошки",
    "stag-idol": "Идол оленя",
    "primate-idol": "Идол примата",
    "idol-of-ralakesh": "Идол Ралакеша",
    "idol-of-sirrius": "Идол Сирриуса",
    "idol-of-eramir": "Идол Эрамира",  # approximate
    "idol-of-eeshta": "Идол Ишты",  # approximate
    "idol-of-grold": "Идол Гролда",  # approximate
    "idol-of-thruldana": "Идол Трульданы",  # approximate
    "idol-of-egrin": "Идол Эгрина",  # approximate
    "idol-of-maxarius": "Идол Максариуса",  # approximate

    # ===================================================================
    # VERISIUM  (CategoryApiId: verisium)
    # ===================================================================
    "verisium-ore": "Веризиевая руда",  # approximate
    "verisium-ingot": "Веризиевый слиток",  # approximate
    "verisium-shard": "Веризиевый осколок",  # approximate

    # ===================================================================
    # VAAL  (CategoryApiId: vaal)
    # ===================================================================
    "vaal-orb-of-the-ancients": "Сфера Ваала древних",  # approximate
    "corrupted-vaal-orb": "Осквернённая сфера Ваала",  # approximate
}

CURRENCY_NAMES_EN: dict[str, str] = {
    # ===================================================================
    # CURRENCY  (CategoryApiId: currency)
    # ===================================================================
    "exalted": "Exalted Orb",
    "chaos": "Chaos Orb",
    "divine": "Divine Orb",
    "vaal": "Vaal Orb",
    "mirror": "Mirror of Kalandra",
    "alch": "Orb of Alchemy",
    "transmute": "Orb of Transmutation",
    "aug": "Orb of Augmentation",
    "chance": "Orb of Chance",
    "annul": "Orb of Annulment",
    "regal": "Regal Orb",
    "whetstone": "Blacksmith's Whetstone",
    "scrap": "Armourer's Scrap",
    "bauble": "Glassblower's Bauble",
    "gcp": "Gemcutter's Prism",
    "etcher": "Arcanist's Etcher",
    "artificers": "Artificer's Orb",
    "wisdom": "Scroll of Wisdom",
    "fracturing-orb": "Fracturing Orb",
    "chance-shard": "Chance Shard",
    "regal-shard": "Regal Shard",
    "artificers-shard": "Artificer's Shard",
    "transmutation-shard": "Transmutation Shard",
    "greater-chaos-orb": "Greater Chaos Orb",
    "greater-exalted-orb": "Greater Exalted Orb",
    "greater-orb-of-transmutation": "Greater Orb of Transmutation",
    "greater-orb-of-augmentation": "Greater Orb of Augmentation",
    "greater-regal-orb": "Greater Regal Orb",
    "greater-jewellers-orb": "Greater Jeweller's Orb",
    "lesser-jewellers-orb": "Lesser Jeweller's Orb",
    "perfect-chaos-orb": "Perfect Chaos Orb",
    "perfect-exalted-orb": "Perfect Exalted Orb",
    "perfect-jewellers-orb": "Perfect Jeweller's Orb",
    "perfect-orb-of-transmutation": "Perfect Orb of Transmutation",
    "perfect-orb-of-augmentation": "Perfect Orb of Augmentation",
    "perfect-regal-orb": "Perfect Regal Orb",
    "cryptic-key": "Cryptic Key",
    "hinekoras-lock": "Hinekora's Lock",
    "portal": "Portal Scroll",
    "identify": "Scroll of Identification",
    "scouring": "Orb of Scouring",
    "regret": "Orb of Regret",
    "fusings": "Orb of Fusing",
    "chromatic": "Chromatic Orb",
    "jeweller": "Jeweller's Orb",
    "blessed": "Blessed Orb",
    "eternal": "Eternal Orb",
    "silver": "Silver Coin",
    "gold": "Gold",
    "perandus": "Perandus Coin",
    "alteration": "Orb of Alteration",

    # ===================================================================
    # FRAGMENTS  (CategoryApiId: fragments)
    # ===================================================================
    "raven-touched-shard": "Raven-Touched Shard",
    "head-of-the-king": "Head of the King",

    # ===================================================================
    # RUNES  (CategoryApiId: runes)
    # ===================================================================
    "astrids-creativity": "Astrid's Creativity",
    "fire-rune-tier-1": "Fire Rune Tier 1",
    "fire-rune-tier-2": "Fire Rune Tier 2",
    "fire-rune-tier-3": "Fire Rune Tier 3",
    "ice-rune-tier-1": "Ice Rune Tier 1",
    "ice-rune-tier-2": "Ice Rune Tier 2",
    "ice-rune-tier-3": "Ice Rune Tier 3",
    "lightning-rune-tier-1": "Lightning Rune Tier 1",
    "lightning-rune-tier-2": "Lightning Rune Tier 2",
    "lightning-rune-tier-3": "Lightning Rune Tier 3",

    # ===================================================================
    # ESSENCES  (CategoryApiId: essences)
    # ===================================================================
    "essence-of-enfeeblement": "Essence of Enfeeblement",
    "essence-of-sorrow": "Essence of Sorrow",
    "essence-of-rage": "Essence of Rage",
    "essence-of-suffering": "Essence of Suffering",
    "essence-of-wrath": "Essence of Wrath",
    "essence-of-doubt": "Essence of Doubt",
    "essence-of-anger": "Essence of Anger",
    "essence-of-torment": "Essence of Torment",
    "essence-of-fear": "Essence of Fear",
    "essence-of-horror": "Essence of Horror",
    "essence-of-delirium": "Essence of Delirium",
    "essence-of-hysteria": "Essence of Hysteria",
    "essence-of-insanity": "Essence of Insanity",
    "deafening-essence-of-enfeeblement": "Deafening Essence of Enfeeblement",
    "deafening-essence-of-sorrow": "Deafening Essence of Sorrow",
    "deafening-essence-of-rage": "Deafening Essence of Rage",
    "deafening-essence-of-suffering": "Deafening Essence of Suffering",
    "deafening-essence-of-wrath": "Deafening Essence of Wrath",
    "deafening-essence-of-doubt": "Deafening Essence of Doubt",
    "deafening-essence-of-anger": "Deafening Essence of Anger",
    "deafening-essence-of-torment": "Deafening Essence of Torment",
    "deafening-essence-of-fear": "Deafening Essence of Fear",
    "deafening-essence-of-horror": "Deafening Essence of Horror",
    "deafening-essence-of-delirium": "Deafening Essence of Delirium",
    "deafening-essence-of-hysteria": "Deafening Essence of Hysteria",
    "deafening-essence-of-insanity": "Deafening Essence of Insanity",
    "life-essence": "Life Essence",
    "mana-essence": "Mana Essence",

    # ===================================================================
    # ULTIMATUM / SOUL CORES  (CategoryApiId: ultimatum)
    # ===================================================================
    "soul-core-of-quipolatl": "Soul Core of Quipolatl",
    "soul-core-of-azcapa": "Soul Core of Azcapa",
    "soul-core-of-opiloti": "Soul Core of Opiloti",
    "soul-core-of-zalatl": "Soul Core of Zalatl",
    "soul-core-of-cholotl": "Soul Core of Cholotl",
    "soul-core-of-tacati": "Soul Core of Tacati",
    "soul-core-of-citaqualotl": "Soul Core of Citaqualotl",
    "soul-core-of-jiquani": "Soul Core of Jiquani",
    "soul-core-of-zantipi": "Soul Core of Zantipi",
    "soul-core-of-ticaba": "Soul Core of Ticaba",
    "soul-core-of-topotante": "Soul Core of Topotante",
    "soul-core-of-xopec": "Soul Core of Xopec",
    "soul-core-of-atmohua": "Soul Core of Atmohua",
    "soul-core-of-tzamoto": "Soul Core of Tzamoto",
    "soul-core-of-puhuarte": "Soul Core of Puhuarte",
    "opilotis-soul-core-of-assault": "Opiloti's Soul Core of Assault",
    "xopecs-soul-core-of-power": "Xopec's Soul Core of Power",
    "quipolatls-soul-core-of-flow": "Quipolatl's Soul Core of Flow",
    "tzamotos-soul-core-of-ferocity": "Tzamoto's Soul Core of Ferocity",
    "guatelitzis-soul-core-of-endurance": "Guatelitzi's Soul Core of Endurance",
    "estazuntis-soul-core-of-convalescence": "Estazunti's Soul Core of Convalescence",
    "xipocados-soul-core-of-dominion": "Xipocado's Soul Core of Dominion",
    "tacatis-soul-core-of-affliction": "Tacati's Soul Core of Affliction",
    "hayoxis-soul-core-of-heatproofing": "Hayoxi's Soul Core of Heatproofing",
    "atmohuas-soul-core-of-retreat": "Atmohua's Soul Core of Retreat",

    # ===================================================================
    # EXPEDITION  (CategoryApiId: expedition)
    # ===================================================================
    "aldurs-saga": "Aldur's Saga",
    "olroths-conviction": "Olroth's Conviction",
    "rigwalds-ferocity": "Rigwald's Ferocity",
    "voranas-siege": "Vorana's Siege",
    "gwenithas-gamble": "Gwenitha's Gamble",
    "medveds-might": "Medved's Might",
    "tujen-penny": "Tujen's Penny",
    "rostas-faith": "Rosta's Faith",
    "ursas-resolution": "Ursa's Resolution",
    "sukaas-dash": "Sukaa's Dash",
    "dannigs-honour": "Dannig's Honour",
    "kalguur-rune": "Kalguur Rune",
    "expedition-logbook": "Expedition Logbook",
    "artifact-of-the-chayula": "Artifact of the Chayula",
    "artifact-of-the-vaal": "Artifact of the Vaal",
    "artifact-of-the-abyss": "Artifact of the Abyss",
    "artifact-of-the-breach": "Artifact of the Breach",
    "sun-touched-helmet": "Sun-Touched Helmet",
    "sun-touched-armour": "Sun-Touched Armour",
    "sun-touched-gloves": "Sun-Touched Gloves",
    "sun-touched-boots": "Sun-Touched Boots",
    "sun-touched-weapon": "Sun-Touched Weapon",

    # ===================================================================
    # RITUAL OMENS  (CategoryApiId: ritual)
    # ===================================================================
    "omen-of-whittling": "Omen of Whittling",
    "omen-of-chance": "Omen of Chance",
    "omen-of-light": "Omen of Light",
    "omen-of-abyssal-echoes": "Omen of Abyssal Echoes",
    "omen-of-amelioration": "Omen of Amelioration",
    "omen-of-sinistral-erasure": "Omen of Sinistral Erasure",
    "omen-of-sinistral-annulment": "Omen of Sinistral Annulment",
    "omen-of-dextral-annulment": "Omen of Dextral Annulment",
    "omen-of-dextral-erasure": "Omen of Dextral Erasure",
    "omen-of-sinistral-crystallisation": "Omen of Sinistral Crystallisation",
    "omen-of-dextral-crystallisation": "Omen of Dextral Crystallisation",
    "omen-of-sinistral-exaltation": "Omen of Sinistral Exaltation",
    "omen-of-greater-exaltation": "Omen of Greater Exaltation",
    "omen-of-sanctification": "Omen of Sanctification",
    "omen-of-the-blessed": "Omen of the Blessed",
    "omen-of-catalysing-exaltation": "Omen of Catalysing Exaltation",
    "omen-of-the-hunt": "Omen of the Hunt",
    "omen-of-secret-compartments": "Omen of Secret Compartments",
    "omen-of-reinforcements": "Omen of Reinforcements",
    "omen-of-answered-prayers": "Omen of Answered Prayers",
    "omen-of-the-ancients": "Omen of the Ancients",
    "omen-of-chaotic-quantity": "Omen of Chaotic Quantity",
    "omen-of-chaotic-monsters": "Omen of Chaotic Monsters",
    "omen-of-chaotic-rarity": "Omen of Chaotic Rarity",
    "omen-of-chaotic-effectiveness": "Omen of Chaotic Effectiveness",
    "omen-of-sinistral-necromancy": "Omen of Sinistral Necromancy",
    "omen-of-the-blackblooded": "Omen of the Blackblooded",
    "omen-of-putrefaction": "Omen of Putrefaction",
    "omen-of-bartering": "Omen of Bartering",

    # ===================================================================
    # VAULTKEYS / RELIQUARY KEYS  (CategoryApiId: vaultkeys)
    # ===================================================================
    "twilight-reliquary-key": "Twilight Reliquary Key",
    "the-arbiters-reliquary-key": "The Arbiter's Reliquary Key",
    "xeshts-reliquary-key": "Xesht's Reliquary Key",
    "ritualistic-reliquary-key": "Ritualistic Reliquary Key",
    "olroths-reliquary-key": "Olroth's Reliquary Key",
    "the-trialmasters-reliquary-key": "The Trialmaster's Reliquary Key",
    "against-the-darkness": "Against the Darkness",
    "tangmazus-reliquary-key": "Tangmazu's Reliquary Key",
    "temporalis": "Zarokh's Reliquary Key: Temporalis",

    # ===================================================================
    # BREACH  (CategoryApiId: breach)
    # ===================================================================
    "uul-netols-embrace": "Uul-Netol's Embrace",
    "xophs-blood": "Xoph's Blood",
    "tul-fall": "Tul's Fall",
    "eshs-breach": "Esh's Breach",
    "chayulas-breach": "Chayula's Breach",
    "splinter-of-uul-netol": "Splinter of Uul-Netol",
    "splinter-of-xoph": "Splinter of Xoph",
    "splinter-of-tul": "Splinter of Tul",
    "splinter-of-esh": "Splinter of Esh",
    "splinter-of-chayula": "Splinter of Chayula",
    "breachstone-of-uul-netol": "Breachstone of Uul-Netol",
    "breachstone-of-xoph": "Breachstone of Xoph",
    "breachstone-of-tul": "Breachstone of Tul",
    "breachstone-of-esh": "Breachstone of Esh",
    "breachstone-of-chayula": "Breachstone of Chayula",
    "breach-catalyst-life": "Breach Catalyst: Life",
    "breach-catalyst-fire": "Breach Catalyst: Fire",
    "breach-catalyst-cold": "Breach Catalyst: Cold",
    "breach-catalyst-lightning": "Breach Catalyst: Lightning",

    # ===================================================================
    # ABYSS  (CategoryApiId: abyss)
    # ===================================================================
    "rakiatas-flow": "Rakiata's Flow",
    "garukhans-resolve": "Garukhan's Resolve",
    "astrids-creativity": "Astrid's Creativity",
    "gnawed-jawbone": "Gnawed Jawbone",
    "abyssal-wail": "Abyssal Wail",
    "stibnite-doom": "Stibnite Doom",
    "profane-vigor": "Profane Vigor",

    # ===================================================================
    # UNCUT GEMS  (CategoryApiId: uncutgems)
    # ===================================================================
    "uncut-skill-gem": "Uncut Skill Gem",
    "uncut-support-gem": "Uncut Support Gem",
    "uncut-spirit-gem": "Uncut Spirit Gem",

    # ===================================================================
    # LINEAGE SUPPORT GEMS  (CategoryApiId: lineagesupportgems)
    # ===================================================================
    "lineage-lifetap": "Lineage: Lifetap",
    "lineage-omnicurse": "Lineage: Omnicurse",
    "lineage-unbound-malice": "Lineage: Unbound Malice",

    # ===================================================================
    # DELIRIUM  (CategoryApiId: delirium)
    # ===================================================================
    "diluted-liquid-ire": "Diluted Liquid Ire",
    "diluted-liquid-guilt": "Diluted Liquid Guilt",
    "diluted-liquid-greed": "Diluted Liquid Greed",
    "liquid-paranoia": "Liquid Paranoia",
    "liquid-envy": "Liquid Envy",
    "liquid-disgust": "Liquid Disgust",
    "liquid-despair": "Liquid Despair",
    "concentrated-liquid-fear": "Concentrated Liquid Fear",
    "concentrated-liquid-suffering": "Concentrated Liquid Suffering",
    "concentrated-liquid-isolation": "Concentrated Liquid Isolation",
    "potent-liquid-contempt": "Potent Liquid Contempt",
    "potent-liquid-ferocity": "Potent Liquid Ferocity",
    "potent-liquid-melancholy": "Potent Liquid Melancholy",
    "ancient-potent-liquid-contempt": "Ancient Potent Liquid Contempt",
    "ancient-potent-liquid-ferocity": "Ancient Potent Liquid Ferocity",
    "ancient-potent-liquid-melancholy": "Ancient Potent Liquid Melancholy",
    "ancient-concentrated-liquid-isolation": "Ancient Concentrated Liquid Isolation",
    "ancient-concentrated-liquid-fear": "Ancient Concentrated Liquid Fear",
    "ancient-concentrated-liquid-suffering": "Ancient Concentrated Liquid Suffering",
    "ancient-liquid-despair": "Ancient Liquid Despair",
    "ancient-liquid-disgust": "Ancient Liquid Disgust",
    "ancient-liquid-paranoia": "Ancient Liquid Paranoia",
    "ancient-liquid-envy": "Ancient Liquid Envy",
    "ancient-diluted-liquid-greed": "Ancient Diluted Liquid Greed",
    "ancient-diluted-liquid-guilt": "Ancient Diluted Liquid Guilt",
    "distilled-ire": "Distilled Ire",
    "distilled-guilt": "Distilled Guilt",
    "distilled-greed": "Distilled Greed",
    "distilled-paranoia": "Distilled Paranoia",
    "distilled-envy": "Distilled Envy",
    "distilled-disgust": "Distilled Disgust",
    "distilled-despair": "Distilled Despair",
    "distilled-fear": "Distilled Fear",
    "distilled-suffering": "Distilled Suffering",
    "distilled-isolation": "Distilled Isolation",

    # ===================================================================
    # INCURSION  (CategoryApiId: incursion)
    # ===================================================================
    "call-of-the-shadows": "Call of the Shadows",
    "incursion-greater-vaal-orb": "Incursion Greater Vaal Orb",
    "incursion-vaal-orb": "Incursion Vaal Orb",

    # ===================================================================
    # IDOLS  (CategoryApiId: idol)
    # ===================================================================
    "fox-idol": "Fox Idol",
    "rabbit-idol": "Rabbit Idol",
    "wolf-idol": "Wolf Idol",
    "ox-idol": "Ox Idol",
    "bear-idol": "Bear Idol",
    "boar-idol": "Boar Idol",
    "owl-idol": "Owl Idol",
    "cat-idol": "Cat Idol",
    "stag-idol": "Stag Idol",
    "primate-idol": "Primate Idol",
    "idol-of-ralakesh": "Idol of Ralakesh",
    "idol-of-sirrius": "Idol of Sirrius",
    "idol-of-eramir": "Idol of Eramir",
    "idol-of-eeshta": "Idol of Eeshta",
    "idol-of-grold": "Idol of Grold",
    "idol-of-thruldana": "Idol of Thruldana",
    "idol-of-egrin": "Idol of Egrin",
    "idol-of-maxarius": "Idol of Maxarius",

    # ===================================================================
    # VERISIUM  (CategoryApiId: verisium)
    # ===================================================================
    "verisium-ore": "Verisium Ore",
    "verisium-ingot": "Verisium Ingot",
    "verisium-shard": "Verisium Shard",

    # ===================================================================
    # VAAL  (CategoryApiId: vaal)
    # ===================================================================
    "vaal-orb-of-the-ancients": "Vaal Orb of the Ancients",
    "corrupted-vaal-orb": "Corrupted Vaal Orb",
}

# ---------------------------------------------------------------------------
# Reverse lookup helpers
# ---------------------------------------------------------------------------

def get_ru_name(api_id: str) -> str | None:
    """Return the Russian name for an api_id, or None if not found."""
    return CURRENCY_NAMES_RU.get(api_id)


def get_en_name(api_id: str) -> str | None:
    """Return the English name for an api_id, or None if not found."""
    return CURRENCY_NAMES_EN.get(api_id)


def get_category_ru(category_api_id: str) -> str | None:
    """Return the Russian category label for a category api_id, or None if not found."""
    return CATEGORY_NAMES_RU.get(category_api_id)


def get_category_en(category_api_id: str) -> str | None:
    """Return the English category label for a category api_id, or None if not found."""
    return CATEGORY_NAMES_EN.get(category_api_id)
