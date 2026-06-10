"""
Russian and English name mappings for PoE2 currencies and items.

Maps api_id (from POE2Scout API) to localized display names.
Used by the backend API to return translated names alongside the api_id.

Sources:
  - poe2db.tw/ru/ — verified Russian localization from the PoE2 wiki
  - poedb.tw/ru/ — verified Russian names from the PoE1 client
  - config.yaml liquid_chain sections (confirmed ru_name values)
  - PoE1 Russian client names carried over to PoE2 (standard orbs, scrolls)
  - Best-effort translation for items without official RU client data (# approximate)

Maintainer notes:
  - Entries marked "# poe2db" are verified against poe2db.tw/ru/ (PoE2 wiki).
  - Entries marked "# poedb" are verified against poedb.tw/ru/ (PoE1 Russian client).
  - Entries marked "# approximate" are not verified against any official source.
  - When the official RU translation becomes available, remove the # approximate tag.
  - Standard PoE1 orbs (portal, scouring, regret, etc.) are verified — no tag.
  - Keep entries sorted by category for maintainability.
  - PoE2 uses a different essence system: Lesser -> base -> Greater -> Perfect
    (no "Deafening" tier — those are PoE1 carryovers that may not exist in PoE2).
  - PoE2 Russian client uses "Иш" for "Esh" (not "Эш" as in some PoE1 translations).
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
    "expedition": "Экспедиция",
    "ritual": "Омены ритуала",
    "vaultkeys": "Ключи реликвария",
    "breach": "Разлом",
    "abyss": "Бездна",
    "uncutgems": "Неогранённые камни",
    "lineagesupportgems": "Династические камни поддержки",
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
    "etcher": "Резец чародея",  # poe2db
    "artificers": "Сфера астромантии",  # poe2db
    "wisdom": "Свиток мудрости",
    "fracturing-orb": "Сфера раскалывания",
    "chance-shard": "Осколок удачи",
    "regal-shard": "Осколок коронованной сферы",
    "artificers-shard": "Осколок астромантии",  # poe2db
    "transmutation-shard": "Осколок сферы превращения",
    "greater-chaos-orb": "Большая сфера хаоса",  # poe2db
    "greater-exalted-orb": "Большая сфера возвышения",  # poe2db
    "greater-orb-of-transmutation": "Большая сфера превращения",  # poe2db
    "greater-orb-of-augmentation": "Большая сфера усиления",  # poe2db
    "greater-regal-orb": "Большая сфера царей",  # poe2db
    "greater-jewellers-orb": "Большая сфера златокузнеца",  # poe2db
    "lesser-jewellers-orb": "Малая сфера златокузнеца",  # poe2db
    "perfect-chaos-orb": "Совершенная сфера хаоса",  # poe2db
    "perfect-exalted-orb": "Совершенная сфера возвышения",  # poe2db
    "perfect-jewellers-orb": "Совершенная сфера златокузнеца",  # poe2db
    "perfect-orb-of-transmutation": "Совершенная сфера превращения",  # poe2db
    "perfect-orb-of-augmentation": "Совершенная сфера усиления",  # poe2db
    "perfect-regal-orb": "Совершенная сфера царей",  # poe2db
    "cryptic-key": "Скрытый ключ",  # poe2db
    "hinekoras-lock": "Прядь Хинекоры",  # poe2db
    "portal": "Свиток портала",
    "identify": "Свиток опознания",
    "scouring": "Сфера очищения",
    "regret": "Сфера сожаления",
    "fusings": "Сфера слияния",
    "chromatic": "Хроматическая сфера",
    "jeweller": "Сфера ювелира",
    "blessed": "Благословенная сфера",
    "eternal": "Вечная сфера",
    "silver": "Серебряная монета",
    "gold": "Золото",
    "perandus": "Монета Перандуса",
    "alteration": "Сфера перемен",

    # ===================================================================
    # FRAGMENTS  (CategoryApiId: fragments)
    # ===================================================================
    "raven-touched-shard": "Осколок, тронутый вороном",
    "head-of-the-king": "Голова короля",

    # ===================================================================
    # RUNES  (CategoryApiId: runes)
    # ===================================================================
    "astrids-creativity": "Творчество Астрид",
    # PoE2 runes — fire/ice/lightning tiers
    "fire-rune-tier-1": "Огненная руна I уровня",
    "fire-rune-tier-2": "Огненная руна II уровня",
    "fire-rune-tier-3": "Огненная руна III уровня",
    "ice-rune-tier-1": "Ледяная руна I уровня",
    "ice-rune-tier-2": "Ледяная руна II уровня",
    "ice-rune-tier-3": "Ледяная руна III уровня",
    "lightning-rune-tier-1": "Руны молнии I уровня",
    "lightning-rune-tier-2": "Руны молнии II уровня",
    "lightning-rune-tier-3": "Руны молнии III уровня",

    # ===================================================================
    # ESSENCES  (CategoryApiId: essences)
    # ===================================================================
    # PoE1 essences (not in PoE2 — may not appear in API data)
    "essence-of-enfeeblement": "Сущность ослабления",  # approximate — PoE1 only
    "essence-of-sorrow": "Сущность печали",  # poedb — PoE1 only
    "essence-of-rage": "Сущность ярости",  # poedb — PoE1 only
    "essence-of-suffering": "Сущность страдания",  # poedb — PoE1 only
    "essence-of-wrath": "Сущность гнева",  # poedb — PoE1 only
    "essence-of-doubt": "Сущность сомнения",  # poedb — PoE1 only
    "essence-of-anger": "Сущность злобы",  # poedb — PoE1 only
    "essence-of-torment": "Сущность мучения",  # poedb — PoE1 only
    "essence-of-fear": "Сущность страха",  # poedb — PoE1 only
    # PoE2 essences (confirmed from poe2db)
    "essence-of-horror": "Сущность ужаса",  # poe2db
    "essence-of-delirium": "Сущность бреда",  # poe2db
    "essence-of-hysteria": "Сущность истерии",  # poe2db
    "essence-of-insanity": "Сущность безумия",  # poe2db
    "essence-of-ice": "Сущность льда",  # poe2db
    "essence-of-flames": "Сущность пламени",  # poe2db
    "essence-of-the-mind": "Сущность разума",  # poe2db
    "essence-of-the-body": "Сущность тела",  # poe2db
    "essence-of-opulence": "Сущность изобилия",  # poe2db
    "essence-of-ruin": "Сущность гибели",  # poe2db
    "essence-of-battle": "Сущность битвы",  # poe2db
    "essence-of-sorcery": "Сущность колдовства",  # poe2db
    "essence-of-alacrity": "Сущность живости",  # poe2db
    "essence-of-command": "Сущность повеления",  # poe2db
    "essence-of-enhancement": "Сущность улучшения",  # poe2db
    "essence-of-electricity": "Сущность электричества",  # poe2db
    "essence-of-grounding": "Сущность заземления",  # poe2db
    "essence-of-haste": "Сущность спешки",  # poe2db
    "essence-of-insulation": "Сущность изоляции",  # poe2db
    "essence-of-seeking": "Сущность искания",  # poe2db
    "essence-of-thawing": "Сущность таяния",  # poe2db
    "essence-of-abrasion": "Сущность разрушения",  # poe2db
    "essence-of-the-abyss": "Сущность Бездны",  # poe2db
    "essence-of-the-breach": "Сущность Разлома",  # poe2db
    "essence-of-the-infinite": "Сущность бесконечности",  # poe2db
    # PoE1 Deafening essences (not in PoE2)
    "deafening-essence-of-enfeeblement": "Оглушающая сущность ослабления",  # approximate — PoE1 only
    "deafening-essence-of-sorrow": "Оглушающая сущность печали",  # poedb — PoE1 only
    "deafening-essence-of-rage": "Оглушающая сущность ярости",  # poedb — PoE1 only
    "deafening-essence-of-suffering": "Оглушающая сущность страдания",  # poedb — PoE1 only
    "deafening-essence-of-wrath": "Оглушающая сущность гнева",  # poedb — PoE1 only
    "deafening-essence-of-doubt": "Оглушающая сущность сомнения",  # poedb — PoE1 only
    "deafening-essence-of-anger": "Оглушающая сущность злобы",  # poedb — PoE1 only (злобы, not злости)
    "deafening-essence-of-torment": "Оглушающая сущность мучения",  # poedb — PoE1 only
    "deafening-essence-of-fear": "Оглушающая сущность страха",  # poedb — PoE1 only
    "deafening-essence-of-horror": "Оглушающая сущность ужаса",  # poedb — PoE1 only
    "deafening-essence-of-delirium": "Оглушающая сущность бреда",  # poedb — PoE1 only (delirium = бред, not безумие)
    "deafening-essence-of-hysteria": "Оглушающая сущность истерии",  # poedb — PoE1 only
    "deafening-essence-of-insanity": "Оглушающая сущность безумия",  # poedb — PoE1 only
    "life-essence": "Сущность жизни",  # approximate
    "mana-essence": "Сущность маны",  # approximate
    # PoE2 Greater essences (confirmed from poe2db)
    "greater-essence-of-ice": "Большая сущность льда",  # poe2db
    "greater-essence-of-flames": "Большая сущность пламени",  # poe2db
    "greater-essence-of-the-mind": "Большая сущность разума",  # poe2db
    "greater-essence-of-the-body": "Большая сущность тела",  # poe2db
    "greater-essence-of-opulence": "Большая сущность изобилия",  # poe2db
    "greater-essence-of-ruin": "Большая сущность гибели",  # poe2db
    "greater-essence-of-battle": "Большая сущность битвы",  # poe2db
    "greater-essence-of-sorcery": "Большая сущность колдовства",  # poe2db
    "greater-essence-of-alacrity": "Большая сущность живости",  # poe2db
    "greater-essence-of-command": "Большая сущность повеления",  # poe2db
    "greater-essence-of-enhancement": "Большая сущность улучшения",  # poe2db
    "greater-essence-of-electricity": "Большая сущность электричества",  # poe2db
    "greater-essence-of-grounding": "Большая сущность заземления",  # poe2db
    "greater-essence-of-haste": "Большая сущность спешки",  # poe2db
    "greater-essence-of-insulation": "Большая сущность изоляции",  # poe2db
    "greater-essence-of-seeking": "Большая сущность искания",  # poe2db
    "greater-essence-of-thawing": "Большая сущность таяния",  # poe2db
    "greater-essence-of-abrasion": "Большая сущность разрушения",  # poe2db
    "greater-essence-of-the-infinite": "Большая сущность бесконечности",  # poe2db
    # PoE2 Lesser essences (confirmed from poe2db)
    "lesser-essence-of-ice": "Малая сущность льда",  # poe2db
    "lesser-essence-of-flames": "Малая сущность пламени",  # poe2db
    "lesser-essence-of-the-mind": "Малая сущность разума",  # poe2db
    "lesser-essence-of-the-body": "Малая сущность тела",  # poe2db
    "lesser-essence-of-opulence": "Малая сущность изобилия",  # poe2db
    "lesser-essence-of-ruin": "Малая сущность гибели",  # poe2db
    "lesser-essence-of-battle": "Малая сущность битвы",  # poe2db
    "lesser-essence-of-sorcery": "Малая сущность колдовства",  # poe2db
    "lesser-essence-of-alacrity": "Малая сущность живости",  # poe2db
    "lesser-essence-of-command": "Малая сущность повеления",  # poe2db
    "lesser-essence-of-enhancement": "Малая сущность улучшения",  # poe2db
    "lesser-essence-of-electricity": "Малая сущность электричества",  # poe2db
    "lesser-essence-of-grounding": "Малая сущность заземления",  # poe2db
    "lesser-essence-of-haste": "Малая сущность спешки",  # poe2db
    "lesser-essence-of-insulation": "Малая сущность изоляции",  # poe2db
    "lesser-essence-of-seeking": "Малая сущность искания",  # poe2db
    "lesser-essence-of-thawing": "Малая сущность таяния",  # poe2db
    "lesser-essence-of-abrasion": "Малая сущность разрушения",  # poe2db
    "lesser-essence-of-the-infinite": "Малая сущность бесконечности",  # poe2db
    # PoE2 Perfect essences (confirmed from poe2db)
    "perfect-essence-of-ice": "Совершенная сущность льда",  # poe2db
    "perfect-essence-of-flames": "Совершенная сущность пламени",  # poe2db
    "perfect-essence-of-the-mind": "Совершенная сущность разума",  # poe2db
    "perfect-essence-of-the-body": "Совершенная сущность тела",  # poe2db
    "perfect-essence-of-opulence": "Совершенная сущность изобилия",  # poe2db
    "perfect-essence-of-ruin": "Совершенная сущность гибели",  # poe2db
    "perfect-essence-of-battle": "Совершенная сущность битвы",  # poe2db
    "perfect-essence-of-sorcery": "Совершенная сущность колдовства",  # poe2db
    "perfect-essence-of-alacrity": "Совершенная сущность живости",  # poe2db
    "perfect-essence-of-command": "Совершенная сущность повеления",  # poe2db
    "perfect-essence-of-enhancement": "Совершенная сущность улучшения",  # poe2db
    "perfect-essence-of-electricity": "Совершенная сущность электричества",  # poe2db
    "perfect-essence-of-grounding": "Совершенная сущность заземления",  # poe2db
    "perfect-essence-of-haste": "Совершенная сущность спешки",  # poe2db
    "perfect-essence-of-insulation": "Совершенная сущность изоляции",  # poe2db
    "perfect-essence-of-seeking": "Совершенная сущность искания",  # poe2db
    "perfect-essence-of-thawing": "Совершенная сущность таяния",  # poe2db
    "perfect-essence-of-abrasion": "Совершенная сущность разрушения",  # poe2db
    "perfect-essence-of-the-infinite": "Совершенная сущность бесконечности",  # poe2db

    # ===================================================================
    # ULTIMATUM / SOUL CORES  (CategoryApiId: ultimatum)
    # ===================================================================
    "soul-core-of-quipolatl": "Ядро души Киполатля",
    "soul-core-of-azcapa": "Ядро души Ацкапы",
    "soul-core-of-opiloti": "Ядро души Опилоти",
    "soul-core-of-zalatl": "Ядро души Салатля",
    "soul-core-of-cholotl": "Ядро душ Чолотля",  # poe2db
    "soul-core-of-tacati": "Ядро душ Такати",  # poe2db
    "soul-core-of-citaqualotl": "Ядро душ Ситаквалотля",  # poe2db
    "soul-core-of-jiquani": "Ядро душ Джиквани",  # poe2db
    "soul-core-of-zantipi": "Ядро душ Зантипи",  # poe2db
    "soul-core-of-ticaba": "Ядро душ Тикабы",  # poe2db
    "soul-core-of-topotante": "Ядро душ Топотанте",  # poe2db
    "soul-core-of-xopec": "Ядро душ Шопека",  # poe2db
    "soul-core-of-atmohua": "Ядро душ Атмохвы",  # poe2db
    "soul-core-of-tzamoto": "Ядро душ Цамото",  # poe2db
    "soul-core-of-puhuarte": "Ядро душ Пухварте",  # poe2db
    "opilotis-soul-core-of-assault": "Ядро души натиска Опилоти",
    "xopecs-soul-core-of-power": "Ядро души мощи Шопека",
    "quipolatls-soul-core-of-flow": "Ядро душ потока Квиполатля",  # poe2db
    "tzamotos-soul-core-of-ferocity": "Ядро душ свирепости Цамото",  # poe2db
    "guatelitzis-soul-core-of-endurance": "Ядро душ выносливости Гвателитзи",  # poe2db
    "estazuntis-soul-core-of-convalescence": "Ядро душ оздоровления Эстазунти",  # poe2db
    "xipocados-soul-core-of-dominion": "Ядро душ господства Шипокадо",  # poe2db
    "tacatis-soul-core-of-affliction": "Ядро душ недуга Такати",  # poe2db
    "hayoxis-soul-core-of-heatproofing": "Ядро душ жаростойкости Хайоши",  # poe2db
    "atmohuas-soul-core-of-retreat": "Ядро душ отступления Атмохвы",  # poe2db
    # New PoE2 soul cores (from poe2db)
    "cholotls-soul-core-of-war": "Ядро душ войны Чолотля",  # poe2db
    "citaqualotls-soul-core-of-foulness": "Ядро душ гнусности Ситаквалотля",  # poe2db
    "topotantes-soul-core-of-dampening": "Ядро душ подавления Топотанте",  # poe2db
    "uromotis-soul-core-of-attenuation": "Ядро душ истощения Уромоти",  # poe2db
    "zalatls-soul-core-of-insulation": "Ядро душ изоляции Залатля",  # poe2db

    # ===================================================================
    # EXPEDITION  (CategoryApiId: expedition)
    # ===================================================================
    "aldurs-saga": "Сага Альдура",  # poe2db (Альдура, not Алдура)
    "olroths-conviction": "Сага Олрота",  # poe2db (PoE2: Olroth's Saga)
    "rigwalds-ferocity": "Свирепость Ригвальда",  # poe2db
    "voranas-siege": "Сага Вораны",  # poe2db (PoE2: Vorana's Saga)
    "gwenithas-gamble": "Азарт Гвенифы",  # approximate
    "medveds-might": "Мощь Медведя",  # approximate
    "tujen-penny": "Пенни Туджена",  # approximate
    "rostas-faith": "Вера Росты",  # approximate
    "ursas-resolution": "Решимость Урсы",  # approximate
    "sukaas-dash": "Рывок Сукаа",  # approximate
    "dannigs-honour": "Честь Даннига",  # approximate
    "kalguur-rune": "Руна Калгура",  # approximate
    "expedition-logbook": "Журнал экспедиции",  # poe2db
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
    # Confirmed from poe2db — PoE2 uses "Предзнаменование" (not "Омен")
    "omen-of-whittling": "Предзнаменование оттачивания",  # poe2db
    "omen-of-chance": "Предзнаменование удачи",  # poe2db
    "omen-of-light": "Предзнаменование света",  # poe2db
    "omen-of-abyssal-echoes": "Предзнаменование отголосков Бездны",  # poe2db
    "omen-of-amelioration": "Предзнаменование избавления",  # poe2db
    "omen-of-sinistral-erasure": "Предзнаменование истирания левши",  # poe2db
    "omen-of-sinistral-annulment": "Предзнаменование очищения левши",  # poe2db
    "omen-of-dextral-annulment": "Предзнаменование очищения правши",  # poe2db
    "omen-of-dextral-erasure": "Предзнаменование истирания правши",  # poe2db
    "omen-of-sinistral-crystallisation": "Предзнаменование кристаллизации левши",  # poe2db
    "omen-of-dextral-crystallisation": "Предзнаменование кристаллизации правши",  # poe2db
    "omen-of-sinistral-exaltation": "Предзнаменование возвышения левши",  # poe2db
    "omen-of-greater-exaltation": "Предзнаменование великого возвышения",  # poe2db
    "omen-of-sanctification": "Предзнаменование освящения",  # poe2db
    "omen-of-the-blessed": "Предзнаменование благодатных",  # poe2db
    "omen-of-catalysing-exaltation": "Предзнаменование катализованного возвышения",  # poe2db
    "omen-of-the-hunt": "Предзнаменование охоты",  # poe2db
    "omen-of-secret-compartments": "Предзнаменование тайных отсеков",  # poe2db
    "omen-of-reinforcements": "Предзнаменование подкреплений",  # poe2db
    "omen-of-answered-prayers": "Предзнаменование услышанных молитв",  # poe2db
    "omen-of-the-ancients": "Предзнаменование древних",  # poe2db
    "omen-of-chaotic-quantity": "Предзнаменование хаотичного количества",  # poe2db
    "omen-of-chaotic-monsters": "Предзнаменование хаотичных монстров",  # poe2db
    "omen-of-chaotic-rarity": "Предзнаменование хаотичной редкости",  # poe2db
    "omen-of-chaotic-effectiveness": "Предзнаменование хаотичной эффективности",  # poe2db
    "omen-of-sinistral-necromancy": "Предзнаменование некромантии левши",  # poe2db
    "omen-of-the-blackblooded": "Предзнаменование чернокровных",  # poe2db
    "omen-of-putrefaction": "Предзнаменование разложения",  # poe2db
    "omen-of-bartering": "Предзнаменование бартера",  # poe2db
    # New PoE2 omens (from poe2db)
    "omen-of-corruption": "Предзнаменование осквернения",  # poe2db
    "omen-of-dextral-alchemy": "Предзнаменование алхимии правши",  # poe2db
    "omen-of-dextral-coronation": "Предзнаменование коронации правши",  # poe2db
    "omen-of-dextral-exaltation": "Предзнаменование возвышения правши",  # poe2db
    "omen-of-dextral-necromancy": "Предзнаменование некромантии правши",  # poe2db
    "omen-of-gambling": "Предзнаменование азарта",  # poe2db
    "omen-of-greater-annulment": "Предзнаменование великого очищения",  # poe2db
    "omen-of-homogenising-coronation": "Предзнаменование единой коронации",  # poe2db
    "omen-of-homogenising-exaltation": "Предзнаменование единого возвышения",  # poe2db
    "omen-of-recombination": "Предзнаменование рекомбинации",  # poe2db
    "omen-of-refreshment": "Предзнаменование восполнения",  # poe2db
    "omen-of-resurgence": "Предзнаменование возрождения",  # poe2db
    "omen-of-sinistral-alchemy": "Предзнаменование алхимии левши",  # poe2db
    "omen-of-sinistral-coronation": "Предзнаменование коронации левши",  # poe2db
    "omen-of-the-liege": "Предзнаменование властителя",  # poe2db
    "omen-of-the-sovereign": "Предзнаменование правителя",  # poe2db

    # ===================================================================
    # VAULTKEYS / RELIQUARY KEYS  (CategoryApiId: vaultkeys)
    # ===================================================================
    "twilight-reliquary-key": "Сумеречный ключ реликвария",
    "the-arbiters-reliquary-key": "Ключ реликвария Арбитра",
    "xeshts-reliquary-key": "Ключ реликвария Кшета",
    "ritualistic-reliquary-key": "Ритуалистический ключ реликвария",
    "olroths-reliquary-key": "Ключ реликвария Олрота",
    "the-trialmasters-reliquary-key": "Ключ реликвария Мастера испытаний",
    "against-the-darkness": "Ключ от Реликвария Зарока: Противление тьме",  # poe2db
    "tangmazus-reliquary-key": "Ключ реликвария Тангмазу",
    "temporalis": "Ключ от Реликвария Зарока: Темпоралис",  # poe2db

    # ===================================================================
    # BREACH  (CategoryApiId: breach)
    # ===================================================================
    "uul-netols-embrace": "Объятие Уул-Нетола",
    "xophs-blood": "Кровь Ксофа",  # poedb
    "tul-fall": "Падение Тул",  # poedb
    "eshs-breach": "Разлом Иш",  # poe2db (Иш, not Эш)
    "chayulas-breach": "Разлом Чаюлы",  # poedb
    "splinter-of-uul-netol": "Осколок Уул-Нетола",  # poedb
    "splinter-of-xoph": "Осколок Ксофа",  # poedb
    "splinter-of-tul": "Осколок Тул",  # poedb
    "splinter-of-esh": "Осколок Иш",  # poe2db (Иш, not Эш)
    "splinter-of-chayula": "Осколок Чаюлы",  # poedb
    "breachstone-of-uul-netol": "Камень Разлома Уул-Нетола",  # poedb
    "breachstone-of-xoph": "Камень Разлома Ксофа",  # poedb
    "breachstone-of-tul": "Камень Разлома Тул",  # poedb
    "breachstone-of-esh": "Камень Разлома Иш",  # poe2db (Иш, not Эш)
    "breachstone-of-chayula": "Камень Разлома Чаюлы",  # poedb

    # ===================================================================
    # ABYSS  (CategoryApiId: abyss)
    # ===================================================================
    "rakiatas-flow": "Поток Ракиаты",
    "garukhans-resolve": "Решимость Гарухан",
    "astrids-creativity": "Творчество Астрид",
    # Note: "astrids-creativity" also appears under runes category in API data
    "gnawed-jawbone": "Обглоданная челюсть",  # poe2db
    "abyssal-wail": "Бездонный плач",  # approximate
    "stibnite-doom": "Стибнитовая гибель",  # approximate
    "profane-vigor": "Кощунственная сила",  # approximate

    # ===================================================================
    # UNCUT GEMS  (CategoryApiId: uncutgems)
    # ===================================================================
    "uncut-skill-gem": "Неогранённый камень умения",  # poe2db
    "uncut-support-gem": "Неогранённый камень поддержки",  # poe2db
    "uncut-spirit-gem": "Неогранённый камень духа",  # poe2db (PoE2 uses "камень духа", not "духовный камень")

    # ===================================================================
    # LINEAGE SUPPORT GEMS  (CategoryApiId: lineagesupportgems)
    # ===================================================================
    "lineage-lifetap": "Кровопускание Аталуи",  # approximate — poe2db: Atalui's Bloodletting
    "lineage-omnicurse": "Пагуба Доэдре",  # approximate — poe2db: Doedre's Undoing
    "lineage-unbound-malice": "Мука Ишчейла",  # approximate — poe2db: Ixchel's Torment

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
    "potent-liquid-contempt": "Густое жидкое презрение",  # poe2db
    "potent-liquid-ferocity": "Густая жидкая свирепость",  # poe2db
    "potent-liquid-melancholy": "Густая жидкая меланхолия",  # poe2db
    # --- Ancient variants (from API data) ---
    "ancient-potent-liquid-contempt": "Древнее густое жидкое презрение",  # poe2db
    "ancient-potent-liquid-ferocity": "Древняя густая жидкая свирепость",  # poe2db
    "ancient-potent-liquid-melancholy": "Древняя густая жидкая меланхолия",  # poe2db
    "ancient-concentrated-liquid-isolation": "Древнее концентрированное жидкое отчуждение",  # poe2db
    "ancient-concentrated-liquid-fear": "Древний концентрированный жидкий страх",  # poe2db
    "ancient-concentrated-liquid-suffering": "Древнее концентрированное жидкое страдание",  # poe2db
    "ancient-liquid-despair": "Древнее жидкое отчаяние",  # poe2db
    "ancient-liquid-disgust": "Древнее жидкое отвращение",  # poe2db
    "ancient-liquid-paranoia": "Древняя жидкая паранойя",  # poe2db
    "ancient-liquid-envy": "Древняя жидкая зависть",  # poe2db
    "ancient-diluted-liquid-greed": "Древняя разбавленная жидкая жадность",  # poe2db
    "ancient-diluted-liquid-guilt": "Древняя разбавленная жидкая вина",  # poe2db
    "ancient-diluted-liquid-ire": "Древний разбавленный жидкий гнев",  # poe2db
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
    "boar-idol": "Идол кабана",  # poe2db
    "owl-idol": "Идол совы",
    "cat-idol": "Идол кошки",
    "stag-idol": "Идол оленя",
    "primate-idol": "Идол примата",
    "idol-of-ralakesh": "Идол Ралакеша",
    "idol-of-sirrius": "Идол Сирриуса",
    "idol-of-eramir": "Идол Эрамира",  # poe2db
    "idol-of-eeshta": "Идол Ишты",  # poe2db
    "idol-of-grold": "Идол Грольда",  # poe2db
    "idol-of-thruldana": "Идол Трулданы",  # poe2db
    "idol-of-egrin": "Идол Эгрина",  # poe2db
    "idol-of-maxarius": "Идол Макерия",  # poe2db
    # New PoE2 idols (from poe2db)
    "hawk-idol": "Идол ястреба",  # poe2db
    "panther-idol": "Идол пантеры",  # poe2db
    "snake-idol": "Идол змеи",  # poe2db
    "stoat-idol": "Идол горностая",  # poe2db
    "idol-of-alira": "Идол Алиры",  # poe2db
    "idol-of-greust": "Идол Груста",  # poe2db
    "idol-of-kraityn": "Идол Крайтина",  # poe2db
    "idol-of-oak": "Идол Дуба",  # poe2db
    "idol-of-silk": "Идол Шёлка",  # poe2db
    "idol-of-yeena": "Идол Йины",  # poe2db
    "idol-of-the-martyr": "Идол жертвы",  # poe2db
    "idol-of-the-pharisee": "Идол фарисея",  # poe2db
    "idol-of-the-sycophant": "Идол прислужника",  # poe2db
    "idolatry": "Идолопоклонство",  # poe2db

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

    # ===================================================================
    # CATALYSTS  (from poe2db)
    # ===================================================================
    "xophs-catalyst": "Катализатор Ксофа",  # poe2db
    "eshs-catalyst": "Катализатор Иш",  # poe2db
    "tuls-catalyst": "Катализатор Тул",  # poe2db
    "chayulas-catalyst": "Катализатор Чаюлы",  # poe2db
    "adaptive-catalyst": "Адаптивный катализатор",  # poe2db
    "carapace-catalyst": "Панцирный катализатор",  # poe2db
    "flesh-catalyst": "Плотский катализатор",  # poe2db
    "neural-catalyst": "Невральный катализатор",  # poe2db
    "reaver-catalyst": "Разбойничий катализатор",  # poe2db
    "sibilant-catalyst": "Свистящий катализатор",  # poe2db
    "skittering-catalyst": "Шуршащий катализатор",  # poe2db
    "refined-adaptive-catalyst": "Очищенный адаптивный катализатор",  # poe2db
    "refined-carapace-catalyst": "Очищенный панцирный катализатор",  # poe2db
    "refined-chayulas-catalyst": "Очищенный катализатор Чаюлы",  # poe2db
    "refined-eshs-catalyst": "Очищенный катализатор Иш",  # poe2db
    "refined-flesh-catalyst": "Очищенный плотский катализатор",  # poe2db
    "refined-neural-catalyst": "Очищенный невральный катализатор",  # poe2db
    "refined-reaver-catalyst": "Очищенный разбойничий катализатор",  # poe2db
    "refined-sibilant-catalyst": "Очищенный свистящий катализатор",  # poe2db
    "refined-skittering-catalyst": "Очищенный шуршащий катализатор",  # poe2db
    "refined-tuls-catalyst": "Очищенный катализатор Тул",  # poe2db
    "refined-xophs-catalyst": "Очищенный катализатор Ксофа",  # poe2db

    # ===================================================================
    # BREACH CATALYSTS  (PoE1 only — not found on poe2db, may not exist in PoE2)
    # ===================================================================
    "breach-catalyst-life": "Катализатор разлома: жизнь",  # approximate — PoE1 only
    "breach-catalyst-fire": "Катализатор разлома: огонь",  # approximate — PoE1 only
    "breach-catalyst-cold": "Катализатор разлома: холод",  # approximate — PoE1 only
    "breach-catalyst-lightning": "Катализатор разлома: молния",  # approximate — PoE1 only
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
