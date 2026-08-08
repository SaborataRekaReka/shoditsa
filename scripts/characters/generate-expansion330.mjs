import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUTPUT = path.join(ROOT, 'data', 'characters', 'seeds', 'characters.expansion330.json')

const gutenberg = (query) => `https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(query)}`
const wikisource = (query) => `https://ru.wikisource.org/w/index.php?search=${encodeURIComponent(query)}`

const works = {
  greek: ['Греческая мифология', 'Устная традиция', null, 'Миф', 'Древнегреческая культура', 'https://www.gutenberg.org/ebooks/4928'],
  norse: ['Старшая и Младшая Эдда', 'Скандинавская традиция', null, 'Миф', 'Скандинавская культура', 'https://www.gutenberg.org/ebooks/18947'],
  arthur: ['Артуровский цикл', 'Средневековая традиция', null, 'Легенда', 'Британская культура', gutenberg('King Arthur legends')],
  nibelungen: ['Песнь о Нибелунгах', 'Средневековая традиция', 1200, 'Эпос', 'Германская культура', gutenberg('The Nibelungenlied')],
  beowulf: ['Беовульф', 'Англосаксонская традиция', 1000, 'Эпос', 'Англосаксонская культура', 'https://www.gutenberg.org/ebooks/16328'],
  irish: ['Ирландские героические саги', 'Кельтская традиция', null, 'Эпос', 'Ирландская культура', gutenberg('Cuchulain Irish saga')],
  ru_epics: ['Русские былины', 'Народная традиция', null, 'Былина', 'Русский фольклор', 'https://ru.wikisource.org/wiki/Категория:Былины'],
  ru_tales: ['Народные русские сказки', 'Народная традиция', null, 'Сказка', 'Русский фольклор', 'https://ru.wikisource.org/wiki/Народные_русские_сказки_(Афанасьев)'],
  slavic_myth: ['Славянская мифология', 'Народная традиция', null, 'Миф', 'Славянская культура', wikisource('Славянская мифология')],
  igor: ['Слово о полку Игореве', 'Неизвестный автор', 1185, 'Эпос', 'Древнерусская культура', wikisource('Слово о полку Игореве')],
  grimm: ['Сказки братьев Гримм', 'Якоб и Вильгельм Гримм', 1812, 'Сказка', 'Немецкий фольклор', 'https://www.gutenberg.org/ebooks/2591'],
  perrault: ['Сказки Шарля Перро', 'Шарль Перро', 1697, 'Сказка', 'Французская литература', 'https://www.gutenberg.org/ebooks/29021'],
  andersen: ['Сказки Ханса Кристиана Андерсена', 'Ханс Кристиан Андерсен', 1835, 'Литературная сказка', 'Датская литература', gutenberg('Hans Christian Andersen fairy tales')],
  hoffmann: ['Щелкунчик и Мышиный король', 'Э. Т. А. Гофман', 1816, 'Литературная сказка', 'Немецкая литература', gutenberg('Nutcracker and Mouse King Hoffmann')],
  wilde_tales: ['Счастливый принц и другие сказки', 'Оскар Уайльд', 1888, 'Литературная сказка', 'Британская литература', 'https://www.gutenberg.org/ebooks/902'],
  english_tales: ['Английские народные сказки', 'Народная традиция', null, 'Сказка', 'Английский фольклор', gutenberg('English Fairy Tales Jacobs')],
  gilgamesh: ['Эпос о Гильгамеше', 'Месопотамская традиция', -1800, 'Эпос', 'Месопотамская культура', 'https://sacred-texts.com/ane/eog/'],
  ramayana: ['Рамаяна', 'Вальмики', -300, 'Эпос', 'Индийская культура', gutenberg('Ramayana Valmiki')],
  mahabharata: ['Махабхарата', 'Традиционно Вьяса', -300, 'Эпос', 'Индийская культура', gutenberg('Mahabharata')],
  hindu_myth: ['Индуистская мифология', 'Древняя традиция', null, 'Миф', 'Индийская культура', gutenberg('Hindu mythology')],
  journey_west: ['Путешествие на Запад', 'У Чэнъэнь', 1592, 'Роман', 'Китайская литература', 'https://zh.wikisource.org/wiki/西遊記'],
  chinese_myth: ['Китайская мифология и легенды', 'Народная традиция', null, 'Миф', 'Китайская культура', gutenberg('Myths and Legends of China')],
  japanese_tales: ['Японские сказки и легенды', 'Народная традиция', null, 'Сказка', 'Японская культура', gutenberg('Japanese Fairy Tales Ozaki')],
  anansi: ['Сказки об Ананси', 'Западноафриканская традиция', null, 'Фольклор', 'Западноафриканская культура', gutenberg('Anansi stories')],
  maui: ['Легенды о Мауи', 'Полинезийская традиция', null, 'Миф', 'Полинезийская культура', gutenberg('Legends of Maui')],
  onegin: ['Евгений Онегин', 'Александр Пушкин', 1833, 'Роман в стихах', 'Русская литература', wikisource('Евгений Онегин')],
  hero_time: ['Герой нашего времени', 'Михаил Лермонтов', 1840, 'Роман', 'Русская литература', wikisource('Герой нашего времени')],
  dead_souls: ['Мёртвые души', 'Николай Гоголь', 1842, 'Поэма', 'Русская литература', wikisource('Мёртвые души')],
  crime: ['Преступление и наказание', 'Фёдор Достоевский', 1866, 'Роман', 'Русская литература', wikisource('Преступление и наказание')],
  idiot: ['Идиот', 'Фёдор Достоевский', 1869, 'Роман', 'Русская литература', wikisource('Идиот Достоевский')],
  karamazov: ['Братья Карамазовы', 'Фёдор Достоевский', 1880, 'Роман', 'Русская литература', wikisource('Братья Карамазовы')],
  anna: ['Анна Каренина', 'Лев Толстой', 1878, 'Роман', 'Русская литература', wikisource('Анна Каренина')],
  war_peace: ['Война и мир', 'Лев Толстой', 1869, 'Роман', 'Русская литература', wikisource('Война и мир')],
  fathers: ['Отцы и дети', 'Иван Тургенев', 1862, 'Роман', 'Русская литература', wikisource('Отцы и дети')],
  oblomov: ['Обломов', 'Иван Гончаров', 1859, 'Роман', 'Русская литература', wikisource('Обломов')],
  mumu: ['Муму', 'Иван Тургенев', 1854, 'Рассказ', 'Русская литература', wikisource('Муму')],
  chairs: ['Двенадцать стульев', 'Илья Ильф и Евгений Петров', 1928, 'Роман', 'Русская литература', wikisource('Двенадцать стульев')],
  hamlet: ['Гамлет', 'Уильям Шекспир', 1601, 'Трагедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  romeo: ['Ромео и Джульетта', 'Уильям Шекспир', 1597, 'Трагедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  macbeth: ['Макбет', 'Уильям Шекспир', 1606, 'Трагедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  othello: ['Отелло', 'Уильям Шекспир', 1604, 'Трагедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  lear: ['Король Лир', 'Уильям Шекспир', 1606, 'Трагедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  tempest: ['Буря', 'Уильям Шекспир', 1611, 'Пьеса', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  twelfth: ['Двенадцатая ночь', 'Уильям Шекспир', 1602, 'Комедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  much_ado: ['Много шума из ничего', 'Уильям Шекспир', 1599, 'Комедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  henry: ['Генрих IV', 'Уильям Шекспир', 1598, 'Историческая пьеса', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  merchant: ['Венецианский купец', 'Уильям Шекспир', 1598, 'Пьеса', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  midsummer: ['Сон в летнюю ночь', 'Уильям Шекспир', 1596, 'Комедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  as_you_like: ['Как вам это понравится', 'Уильям Шекспир', 1599, 'Комедия', 'Английская литература', 'https://www.gutenberg.org/ebooks/100'],
  holmes: ['Рассказы о Шерлоке Холмсе', 'Артур Конан Дойл', 1891, 'Детектив', 'Британская литература', 'https://www.gutenberg.org/ebooks/1661'],
  oliver: ['Приключения Оливера Твиста', 'Чарльз Диккенс', 1839, 'Роман', 'Британская литература', 'https://www.gutenberg.org/ebooks/730'],
  christmas: ['Рождественская песнь', 'Чарльз Диккенс', 1843, 'Повесть', 'Британская литература', 'https://www.gutenberg.org/ebooks/46'],
  expectations: ['Большие надежды', 'Чарльз Диккенс', 1861, 'Роман', 'Британская литература', 'https://www.gutenberg.org/ebooks/1400'],
  copperfield: ['Дэвид Копперфилд', 'Чарльз Диккенс', 1850, 'Роман', 'Британская литература', 'https://www.gutenberg.org/ebooks/766'],
  emma: ['Эмма', 'Джейн Остин', 1815, 'Роман', 'Британская литература', 'https://www.gutenberg.org/ebooks/158'],
  sense: ['Разум и чувства', 'Джейн Остин', 1811, 'Роман', 'Британская литература', 'https://www.gutenberg.org/ebooks/161'],
  persuasion: ['Доводы рассудка', 'Джейн Остин', 1818, 'Роман', 'Британская литература', 'https://www.gutenberg.org/ebooks/105'],
  wuthering: ['Грозовой перевал', 'Эмили Бронте', 1847, 'Роман', 'Британская литература', 'https://www.gutenberg.org/ebooks/768'],
  wonderland: ['Алиса в Стране чудес', 'Льюис Кэрролл', 1865, 'Литературная сказка', 'Британская литература', 'https://www.gutenberg.org/ebooks/11'],
  treasure: ['Остров сокровищ', 'Роберт Льюис Стивенсон', 1883, 'Приключения', 'Британская литература', 'https://www.gutenberg.org/ebooks/120'],
  jungle: ['Книга джунглей', 'Редьярд Киплинг', 1894, 'Рассказы', 'Британская литература', 'https://www.gutenberg.org/ebooks/236'],
  miserables: ['Отверженные', 'Виктор Гюго', 1862, 'Роман', 'Французская литература', 'https://www.gutenberg.org/ebooks/135'],
  notre: ['Собор Парижской Богоматери', 'Виктор Гюго', 1831, 'Роман', 'Французская литература', 'https://www.gutenberg.org/ebooks/2610'],
  monte: ['Граф Монте-Кристо', 'Александр Дюма', 1846, 'Роман', 'Французская литература', 'https://www.gutenberg.org/ebooks/1184'],
  musketeers: ['Три мушкетёра', 'Александр Дюма', 1844, 'Роман', 'Французская литература', 'https://www.gutenberg.org/ebooks/1257'],
  around_world: ['Вокруг света за восемьдесят дней', 'Жюль Верн', 1872, 'Приключения', 'Французская литература', 'https://www.gutenberg.org/ebooks/103'],
  bovary: ['Госпожа Бовари', 'Гюстав Флобер', 1857, 'Роман', 'Французская литература', gutenberg('Madame Bovary Flaubert')],
  red_black: ['Красное и чёрное', 'Стендаль', 1830, 'Роман', 'Французская литература', gutenberg('The Red and the Black Stendhal')],
  nana: ['Нана', 'Эмиль Золя', 1880, 'Роман', 'Французская литература', gutenberg('Nana Emile Zola')],
  bel_ami: ['Милый друг', 'Ги де Мопассан', 1885, 'Роман', 'Французская литература', gutenberg('Bel Ami Maupassant')],
  candide: ['Кандид', 'Вольтер', 1759, 'Повесть', 'Французская литература', 'https://www.gutenberg.org/ebooks/19942'],
  faust: ['Фауст', 'Иоганн Вольфганг Гёте', 1808, 'Трагедия', 'Немецкая литература', 'https://www.gutenberg.org/ebooks/14591'],
  tom: ['Приключения Тома Сойера', 'Марк Твен', 1876, 'Роман', 'Американская литература', 'https://www.gutenberg.org/ebooks/74'],
  moby: ['Моби Дик', 'Герман Мелвилл', 1851, 'Роман', 'Американская литература', 'https://www.gutenberg.org/ebooks/2701'],
  oz: ['Удивительный волшебник из страны Оз', 'Лаймен Фрэнк Баум', 1900, 'Литературная сказка', 'Американская литература', 'https://www.gutenberg.org/ebooks/55'],
  little_women: ['Маленькие женщины', 'Луиза Мэй Олкотт', 1868, 'Роман', 'Американская литература', 'https://www.gutenberg.org/ebooks/514'],
  sleepy: ['Легенда о Сонной Лощине', 'Вашингтон Ирвинг', 1820, 'Повесть', 'Американская литература', gutenberg('Legend of Sleepy Hollow')],
  mohicans: ['Последний из могикан', 'Джеймс Фенимор Купер', 1826, 'Роман', 'Американская литература', 'https://www.gutenberg.org/ebooks/940'],
  call_wild: ['Зов предков', 'Джек Лондон', 1903, 'Повесть', 'Американская литература', 'https://www.gutenberg.org/ebooks/215'],
  white_fang: ['Белый Клык', 'Джек Лондон', 1906, 'Роман', 'Американская литература', 'https://www.gutenberg.org/ebooks/910'],
  martin: ['Мартин Иден', 'Джек Лондон', 1909, 'Роман', 'Американская литература', 'https://www.gutenberg.org/ebooks/1056'],
  sea_wolf: ['Морской волк', 'Джек Лондон', 1904, 'Роман', 'Американская литература', 'https://www.gutenberg.org/ebooks/1074'],
  poe: ['Рассказы Эдгара Аллана По', 'Эдгар Аллан По', 1845, 'Готика', 'Американская литература', gutenberg('Edgar Allan Poe tales')],
  mines: ['Копи царя Соломона', 'Генри Райдер Хаггард', 1885, 'Приключения', 'Британская литература', 'https://www.gutenberg.org/ebooks/2166'],
  she: ['Она', 'Генри Райдер Хаггард', 1887, 'Приключения', 'Британская литература', 'https://www.gutenberg.org/ebooks/3155'],
  pimpernel: ['Алый Первоцвет', 'Баронесса Орци', 1905, 'Приключения', 'Британская литература', 'https://www.gutenberg.org/ebooks/60'],
  quixote: ['Дон Кихот', 'Мигель де Сервантес', 1605, 'Роман', 'Испанская литература', 'https://www.gutenberg.org/ebooks/996'],
  don_juan: ['Севильский распутник и каменный гость', 'Тирсо де Молина', 1630, 'Пьеса', 'Испанская литература', gutenberg('Don Juan Tirso de Molina')],
  werther: ['Страдания юного Вертера', 'Иоганн Вольфганг Гёте', 1774, 'Роман', 'Немецкая литература', 'https://www.gutenberg.org/ebooks/2527'],
  munchausen: ['Приключения барона Мюнхгаузена', 'Рудольф Эрих Распе', 1785, 'Приключения', 'Немецкая литература', gutenberg('Baron Munchausen Raspe')],
  eulenspiegel: ['Тиль Уленшпигель', 'Народная традиция', 1515, 'Фольклор', 'Германская культура', gutenberg('Till Eulenspiegel')],
  pinocchio: ['Приключения Пиноккио', 'Карло Коллоди', 1883, 'Литературная сказка', 'Итальянская литература', 'https://www.gutenberg.org/ebooks/500'],
  orlando: ['Неистовый Роланд', 'Лудовико Ариосто', 1532, 'Поэма', 'Итальянская литература', gutenberg('Orlando Furioso Ariosto')],
  betrothed: ['Обручённые', 'Алессандро Мандзони', 1827, 'Роман', 'Итальянская литература', gutenberg('The Betrothed Manzoni')],
  barber: ['Севильский цирюльник', 'Пьер Бомарше', 1775, 'Пьеса', 'Французская литература', gutenberg('Barber of Seville Beaumarchais')],
  carmen: ['Кармен', 'Проспер Мериме', 1845, 'Новелла', 'Французская литература', 'https://www.gutenberg.org/ebooks/2465'],
  arabian: ['Тысяча и одна ночь', 'Народная традиция', null, 'Рамочный рассказ', 'Арабская литература', 'https://www.gutenberg.org/ebooks/3435'],
}

const themes = [
  {
    id: 'classical', settings: ['Античный мир', 'Храм', 'Море'],
    rows: [
      ['hera','Гера','Hera','greek','Женщина','Божество','Бессмертный','e','Правитель;Соперник','Бессмертие;Власть','Диадема;Павлин','regal mature beauty, severe watchful gaze'],
      ['poseidon','Посейдон','Poseidon','greek','Мужчина','Божество','Бессмертный','e','Правитель;Стихийная сила','Власть над морем;Землетрясения','Трезубец;Волны','powerful weathered sea sovereign with salt-dark beard'],
      ['apollo','Аполлон','Apollo','greek','Мужчина','Божество','Бессмертный','e','Покровитель;Пророк','Музыка;Предвидение','Лира;Лавр','radiant athletic adult, refined but not youthful-pretty'],
      ['artemis','Артемида','Artemis','greek','Женщина','Божество','Бессмертный','e','Охотница;Защитник','Стрельба;Связь с природой','Лук;Полумесяц','self-possessed adult huntress, sharp profile and practical drapery'],
      ['ares','Арес','Ares','greek','Мужчина','Божество','Бессмертный','e','Воин;Антагонист','Сверхсила;Фехтование','Копьё;Шлем','battle-scarred adult war god, volatile expression'],
      ['hephaestus','Гефест','Hephaestus','greek','Мужчина','Божество','Бессмертный','m','Кузнец;Создатель','Кузнечное дело;Изобретательство','Молот;Наковальня','broad mature craftsman with strong hands and a visible limp'],
      ['hermes','Гермес','Hermes','greek','Мужчина','Божество','Бессмертный','e','Вестник;Трикстер','Скорость;Красноречие','Кадуцей;Крылатые сандалии','lean quick-eyed adult messenger, alert asymmetrical pose'],
      ['demeter','Деметра','Demeter','greek','Женщина','Божество','Бессмертный','m','Покровитель;Мать','Связь с растениями;Власть над урожаем','Колосья;Факел','dignified mature woman with weathered kindness and contained grief'],
      ['dionysus','Дионис','Dionysus','greek','Мужчина','Божество','Бессмертный','e','Покровитель;Трикстер','Чары;Превращение','Виноградная лоза;Тирс','androgynous adult beauty, ecstatic but unsettling gaze'],
      ['eros','Эрос','Eros','greek','Мужчина','Божество','Бессмертный','e','Испытатель;Посредник','Власть над влечением;Полёт','Лук;Золотая стрела','adult winged archer, mischievous elegance, never childlike'],
      ['hestia','Гестия','Hestia','greek','Женщина','Божество','Бессмертный','m','Хранитель;Покровитель','Власть над огнём;Спокойствие','Очаг;Лампа','serene mature woman, restrained warmth and simple drapery'],
      ['nike','Ника','Nike','greek','Женщина','Божество','Бессмертный','m','Вестник;Покровитель','Полёт;Скорость','Крылья;Венок','dynamic adult winged woman, wind-swept silhouette'],
      ['orpheus','Орфей','Orpheus','greek','Мужчина','Человек','Молодой взрослый','e','Музыкант;Искатель','Музыка;Красноречие','Лира;Тёмная арка','sensitive young adult musician with intense sorrowful eyes'],
      ['eurydice','Эвридика','Eurydice','greek','Женщина','Дух','Молодой взрослый','m','Возлюбленная;Пленница','Стойкость;Связь с подземным миром','Белая вуаль;Тень','ethereal adult woman, quiet tragic beauty, opaque classical dress'],
      ['theseus','Тесей','Theseus','greek','Мужчина','Полубог','Молодой взрослый','e','Главный герой;Воин','Фехтование;Смелость','Клубок нити;Меч','athletic young adult hero with imperfect rugged face'],
      ['ariadne','Ариадна','Ariadne','greek','Женщина','Человек','Молодой взрослый','e','Помощник;Стратег','Изобретательность;Смелость','Клубок нити;Лабиринт','intelligent adult princess, warm sensual magnetism through gaze and posture'],
      ['jason','Ясон','Jason','greek','Мужчина','Человек','Молодой взрослый','e','Главный герой;Мореплаватель','Лидерство;Фехтование','Золотое руно;Корабль','charismatic young captain with weathered seafaring look'],
      ['medea','Медея','Medea','greek','Женщина','Человек','Молодой взрослый','e','Волшебница;Антигерой','Колдовство;Зельеварение','Чаша;Змеиная брошь','magnetic adult sorceress, proud face and dangerous emotional intensity'],
      ['perseus','Персей','Perseus','greek','Мужчина','Полубог','Молодой взрослый','e','Главный герой;Воин','Фехтование;Полёт','Зеркальный щит;Серп','focused young hero, clean readable armor silhouette'],
      ['andromeda','Андромеда','Andromeda','greek','Женщина','Человек','Молодой взрослый','m','Царевна;Пленница','Стойкость;Смелость','Скала;Разорванная цепь','adult princess with dignified vulnerability, windswept opaque drapery'],
      ['icarus','Икар','Icarus','greek','Мужчина','Человек','Юный','e','Мечтатель;Бунтарь','Полёт;Смелость','Восковые крылья;Солнце','adolescent dreamer with handmade wings, energetic non-sensual portrayal'],
      ['daedalus','Дедал','Daedalus','greek','Мужчина','Человек','Взрослый','m','Изобретатель;Отец','Инженерный талант;Мастерство','Циркуль;Крылья','mature ingenious craftsman, tired eyes and ink-stained hands'],
      ['pandora','Пандора','Pandora','greek','Женщина','Созданный человек','Молодой взрослый','e','Испытатель;Первооткрыватель','Любопытство;Обаяние','Сосуд;Рассеянный дым','adult woman with vivid curiosity and restrained mysterious beauty'],
      ['narcissus','Нарцисс','Narcissus','greek','Мужчина','Человек','Молодой взрослый','e','Красавец;Жертва','Красота;Самолюбование','Вода;Белый цветок','striking adult male beauty with aloof reflective gaze'],
      ['psyche','Психея','Psyche','greek','Женщина','Обожествлённый человек','Молодой взрослый','m','Искатель;Возлюбленная','Стойкость;Преображение','Лампа;Крылья бабочки','adult heroine with tender sensual grace and determined eyes'],
      ['atlas','Атлант','Atlas','greek','Мужчина','Титан','Бессмертный','e','Носитель;Пленник','Сверхсила;Стойкость','Небесная сфера;Горы','monumental mature titan bent under cosmic weight'],
      ['sisyphus','Сизиф','Sisyphus','greek','Мужчина','Человек','Взрослый','m','Трикстер;Пленник','Хитрость;Выносливость','Камень;Склон','lean exhausted king with stubborn intelligent gaze'],
      ['hector','Гектор','Hector','greek','Мужчина','Человек','Взрослый','e','Воин;Защитник','Фехтование;Лидерство','Копьё;Троянский шлем','noble mature defender, humane battle-worn face'],
      ['paris','Парис','Paris','greek','Мужчина','Человек','Молодой взрослый','e','Царевич;Лучник','Стрельба;Обаяние','Лук;Золотое яблоко','handsome adult prince with conflicted, slightly vain expression'],
      ['penelope','Пенелопа','Penelope','greek','Женщина','Человек','Взрослый','e','Правитель;Стратег','Хитрость;Ткачество','Ткацкий станок;Нить','mature queen with composed beauty and watchful intelligence'],
    ],
  },
  {
    id: 'northern-legends', settings: ['Легендарный мир', 'Замок', 'Лес'],
    rows: [
      ['odin','Один','Odin','norse','Мужчина','Божество','Бессмертный','e','Правитель;Мудрец','Предвидение;Колдовство','Копьё;Вороны','one-eyed ancient wanderer-king, severe weathered face'],
      ['frigg','Фригг','Frigg','norse','Женщина','Божество','Бессмертный','m','Правитель;Пророк','Предвидение;Ткачество','Веретено;Облака','mature regal woman with controlled grief and quiet authority'],
      ['balder','Бальдр','Baldr','norse','Мужчина','Божество','Бессмертный','e','Любимец;Жертва','Красота;Неуязвимость','Омела;Солнечный диск','radiant adult man with vulnerable warmth, no superhero styling'],
      ['heimdall','Хеймдалль','Heimdallr','norse','Мужчина','Божество','Бессмертный','m','Страж;Вестник','Острый слух;Предвидение','Рог;Радужный мост','vigilant mature guardian with pale braids and piercing gaze'],
      ['tyr','Тюр','Týr','norse','Мужчина','Божество','Бессмертный','m','Воин;Судья','Смелость;Фехтование','Одноручный меч;Волчья цепь','stern one-handed adult warrior, honest unadorned face'],
      ['sif','Сиф','Sif','norse','Женщина','Божество','Бессмертный','m','Покровитель;Воительница','Стойкость;Связь с урожаем','Золотые волосы;Колосья','strong adult woman with extraordinary golden hair and grounded beauty'],
      ['hel','Хель','Hel','norse','Женщина','Божество','Бессмертный','e','Правитель;Судья','Власть над мёртвыми;Бессмертие','Чёрно-белая маска;Ворота','asymmetrical adult underworld queen, half vital and half deathly'],
      ['fenrir','Фенрир','Fenrir','norse','Мужчина','Чудовищный волк','Взрослый','e','Чудовище;Пленник','Сверхсила;Острый нюх','Разорванная цепь;Руна','enormous mythic wolf with intelligent furious eyes'],
      ['jormungandr','Ёрмунганд','Jörmungandr','norse','Мужчина','Мировой змей','Бессмертный','m','Чудовище;Стихийная сила','Яд;Сверхсила','Кольцо-змей;Волны','colossal sea serpent forming a circular silhouette'],
      ['skadi','Скади','Skaði','norse','Женщина','Ётун','Бессмертный','m','Охотница;Воительница','Стрельба;Выносливость','Лыжи;Лук','tall adult mountain huntress, cold weathered beauty'],
      ['idunn','Идунн','Iðunn','norse','Женщина','Божество','Бессмертный','m','Хранитель;Покровитель','Омоложение;Связь с растениями','Яблоки;Ларец','adult orchard guardian with warm natural beauty, never childlike'],
      ['freyr','Фрейр','Freyr','norse','Мужчина','Божество','Бессмертный','m','Правитель;Покровитель','Связь с урожаем;Миротворчество','Золотой вепрь;Солнечный луч','handsome mature fertility god with peaceful masculine warmth'],
      ['sigurd','Сигурд','Sigurðr','norse','Мужчина','Человек','Молодой взрослый','e','Главный герой;Воин','Фехтование;Смелость','Меч;Драконья кровь','young adult dragon-slayer with soot-marked face and practical mail'],
      ['brynhild','Брюнхильда','Brynhildr','norse','Женщина','Валькирия','Взрослый','e','Воительница;Возлюбленная','Фехтование;Предвидение','Крылатый шлем;Огненное кольцо','formidable adult shield-maiden, magnetic tragic beauty, fully armored'],
      ['fafnir','Фафнир','Fáfnir','norse','Мужчина','Дракон','Взрослый','m','Чудовище;Хранитель','Сверхсила;Огненное дыхание','Клад;Шлем','low heavy dragon with traces of former human greed'],
      ['guinevere','Гвиневра','Guinevere','arthur','Женщина','Человек','Взрослый','e','Королева;Возлюбленная','Дипломатия;Самообладание','Корона;Белая роза','mature queen with intelligent sensual presence and restrained medieval dress'],
      ['lancelot','Ланселот','Lancelot','arthur','Мужчина','Человек','Взрослый','e','Воин;Возлюбленный','Фехтование;Верховая езда','Меч;Белый щит','handsome adult knight, conflicted gaze and worn armor'],
      ['gawain','Гавейн','Gawain','arthur','Мужчина','Человек','Взрослый','m','Воин;Испытатель','Фехтование;Верность','Зелёный пояс;Щит','courteous mature knight with sun-weathered face'],
      ['galahad','Галахад','Galahad','arthur','Мужчина','Человек','Молодой взрослый','m','Воин;Искатель','Стойкость;Фехтование','Чаша;Белый плащ','earnest young adult knight, luminous but human'],
      ['percival','Персиваль','Perceval','arthur','Мужчина','Человек','Молодой взрослый','m','Искатель;Воин','Смелость;Обучаемость','Копьё;Чаша','open-faced young knight growing into hard-won wisdom'],
      ['morgan-le-fay','Моргана ле Фей','Morgan le Fay','arthur','Женщина','Волшебница','Взрослый','e','Волшебница;Антигерой','Колдовство;Исцеление','Чёрная книга;Остров','mature sorceress with regal sensual magnetism and unreadable gaze'],
      ['mordred','Мордред','Mordred','arthur','Мужчина','Человек','Молодой взрослый','e','Антагонист;Узурпатор','Фехтование;Манипуляция','Сломанный меч;Чёрный щит','young adult claimant with cold handsome face and contained resentment'],
      ['lady-of-the-lake','Владычица Озера','Lady of the Lake','arthur','Женщина','Волшебное существо','Бессмертный','e','Хранитель;Волшебница','Колдовство;Дар артефактов','Меч из воды;Камыш','timeless adult woman rising from mist, serene uncanny beauty'],
      ['tristan','Тристан','Tristan','arthur','Мужчина','Человек','Молодой взрослый','e','Воин;Возлюбленный','Фехтование;Музыка','Арфа;Меч','romantic adult warrior-musician with melancholy weathered beauty'],
      ['isolde','Изольда','Iseult','arthur','Женщина','Человек','Молодой взрослый','e','Целитель;Возлюбленная','Исцеление;Музыка','Кубок;Травы','adult healer-princess with emotionally charged sensual grace'],
      ['beowulf','Беовульф','Beowulf','beowulf','Мужчина','Человек','Взрослый','e','Главный герой;Воин','Сверхсила;Смелость','Кольчуга;Кубок','massive mature warrior with honest battered face'],
      ['grendel','Грендель','Grendel','beowulf','Мужчина','Чудовище','Взрослый','e','Чудовище;Изгнанник','Сверхсила;Ночное зрение','Зал;Когти','asymmetrical marsh creature, lonely intelligence behind rage'],
      ['hagen','Хаген','Hagen','nibelungen','Мужчина','Человек','Взрослый','m','Воин;Предатель','Фехтование;Хитрость','Копьё;Тёмный плащ','hard-faced veteran with watchful calculating eyes'],
      ['kriemhild','Кримхильда','Kriemhild','nibelungen','Женщина','Человек','Взрослый','m','Королева;Мститель','Воля;Манипуляция','Кольцо;Пламя','mature queen transformed from courtly beauty into ruthless resolve'],
      ['cuchulainn','Кухулин','Cú Chulainn','irish','Мужчина','Полубог','Молодой взрослый','m','Воин;Защитник','Сверхсила;Боевой транс','Копьё;Пёс','compact young adult hero with fierce distorted battle energy'],
    ],
  },
  {
    id: 'slavic', settings: ['Русь', 'Лес', 'Легендарный мир'],
    rows: [
      ['mikula-selyaninovich','Микула Селянинович','Mikula Selyaninovich','ru_epics','Мужчина','Человек','Взрослый','m','Богатырь;Пахарь','Сверхсила;Стойкость','Соха;Земля','powerful mature peasant hero with calm grounded face'],
      ['svyatogor','Святогор','Svyatogor','ru_epics','Мужчина','Великан','Взрослый','e','Богатырь;Странник','Сверхсила;Стойкость','Горы;Каменный гроб','towering old giant-warrior, melancholy and earth-heavy'],
      ['volga-svyatoslavich','Вольга Святославич','Volga Svyatoslavich','ru_epics','Мужчина','Оборотень','Взрослый','m','Богатырь;Князь','Превращение;Хитрость','Сокол;Копьё','lean princely shapeshifter with sharp observant face'],
      ['nastasya-mikulichna','Настасья Микулична','Nastasya Mikulichna','ru_epics','Женщина','Человек','Взрослый','m','Богатырь;Воительница','Сверхсила;Верховая езда','Лук;Боевой конь','tall adult warrior woman, robust beauty and practical armor'],
      ['marya-morevna','Марья Моревна','Marya Morevna','ru_tales','Женщина','Человек','Взрослый','e','Царица;Воительница','Фехтование;Лидерство','Меч;Ключи','commanding adult warrior-queen with elegant, fully clothed magnetism'],
      ['elena-the-wise','Елена Премудрая','Elena the Wise','ru_tales','Женщина','Волшебница','Молодой взрослый','m','Царевна;Волшебница','Колдовство;Мудрость','Волшебная книга;Золотое веретено','adult learned princess with clever gaze, calm beauty and green-gold motifs'],
      ['emelya','Емеля','Emelya','ru_tales','Мужчина','Человек','Молодой взрослый','e','Трикстер;Лентяй','Волшебная речь;Удача','Печь;Щука','scruffy good-natured young man, comic but not caricatured'],
      ['firebird','Жар-птица','Firebird','ru_tales','Женщина','Волшебная птица','Бессмертный','e','Испытатель;Сокровище','Полёт;Сияние','Огненное перо;Золотая клетка','majestic luminous bird with original feather geometry'],
      ['gray-wolf','Серый Волк','Gray Wolf','ru_tales','Мужчина','Говорящее животное','Взрослый','e','Помощник;Проводник','Превращение;Скорость','Серебряная шерсть;Дорога','large intelligent grey wolf with loyal wary eyes'],
      ['kolobok','Колобок','Kolobok','ru_tales','Мужчина','Ожившая еда','Юный','e','Трикстер;Беглец','Скорость;Красноречие','Круглый хлеб;Тропа','expressive round baked creature, graphic and charming, not branded'],
      ['morozko','Морозко','Morozko','ru_tales','Мужчина','Дух природы','Пожилой','e','Испытатель;Покровитель','Холод;Колдовство','Ледяной посох;Иней','ancient winter spirit with frost-cracked beard and stern kindness'],
      ['tsarevna-nesmeyana','Царевна Несмеяна','Princess Who Never Smiled','ru_tales','Женщина','Человек','Молодой взрослый','m','Царевна;Испытатель','Самообладание;Наблюдательность','Слеза;Трон','adult princess with remote sorrowful beauty, restrained pose'],
      ['finist-bright-falcon','Финист Ясный Сокол','Finist the Bright Falcon','ru_tales','Мужчина','Оборотень','Молодой взрослый','e','Царевич;Возлюбленный','Превращение;Полёт','Соколиное перо;Окно','handsome adult shapeshifter with falcon-sharp profile'],
      ['ivan-the-fool','Иван-дурак','Ivan the Fool','ru_tales','Мужчина','Человек','Молодой взрослый','e','Трикстер;Главный герой','Доброта;Удача','Заплатанная рубаха;Дудочка','open-faced rustic youth, warm humorous expression'],
      ['chudo-yudo','Чудо-юдо','Chudo-Yudo','ru_tales','Мужчина','Многоголовое чудовище','Взрослый','m','Чудовище;Антагонист','Сверхсила;Огненное дыхание','Мост;Много голов','original many-headed river monster with readable silhouette'],
      ['likho-one-eyed','Лихо Одноглазое','Likho One-Eyed','slavic_myth','Женщина','Дух несчастья','Бессмертный','m','Чудовище;Испытатель','Проклятие;Сверхсила','Один глаз;Костяная ложка','gaunt one-eyed female spirit, uncanny rather than sexualized'],
      ['domovoy','Домовой','Domovoy','slavic_myth','Мужчина','Домашний дух','Пожилой','e','Хранитель;Трикстер','Невидимость;Предчувствие','Печь;Ключ','small elderly house spirit with wiry beard and watchful warmth'],
      ['kikimora','Кикимора','Kikimora','slavic_myth','Женщина','Домашний дух','Бессмертный','m','Трикстер;Антагонист','Невидимость;Колдовство','Веретено;Тень','thin uncanny household spirit with birdlike posture'],
      ['leshy','Леший','Leshy','slavic_myth','Мужчина','Лесной дух','Бессмертный','e','Хранитель;Трикстер','Превращение;Связь с природой','Посох;Мох','towering forest spirit with bark-like age and shifting scale'],
      ['rusalka','Русалка','Rusalka','slavic_myth','Женщина','Водный дух','Молодой взрослый','e','Искуситель;Жертва','Чары;Власть над водой','Кувшинка;Гребень','haunting adult water spirit with melancholic beauty, opaque wet linen'],
      ['vodyanoy','Водяной','Vodyanoy','slavic_myth','Мужчина','Водный дух','Пожилой','e','Правитель;Трикстер','Власть над водой;Превращение','Тина;Сом','old river sovereign with amphibious traits and tangled beard'],
      ['perun','Перун','Perun','slavic_myth','Мужчина','Божество','Бессмертный','e','Громовержец;Воин','Молнии;Сверхсила','Топор;Дуб','mature thunder god with red-brown beard and storm-worn face'],
      ['veles','Велес','Veles','slavic_myth','Мужчина','Божество','Бессмертный','m','Трикстер;Покровитель','Превращение;Колдовство','Посох;Змей','earthy mature shapeshifter with horn and fur motifs, not a devil cliché'],
      ['mokosh','Мокошь','Mokosh','slavic_myth','Женщина','Божество','Бессмертный','m','Покровитель;Мать','Ткачество;Связь с землёй','Веретено;Влажная земля','mature maternal deity with strong hands and solemn beauty'],
      ['yaroslavna','Ярославна','Yaroslavna','igor','Женщина','Человек','Взрослый','m','Княгиня;Возлюбленная','Воля;Красноречие','Крепостная стена;Ветер','adult princess in grief, dignified face turned toward the horizon'],
      ['prince-igor','Князь Игорь','Prince Igor','igor','Мужчина','Человек','Взрослый','m','Князь;Воин','Лидерство;Фехтование','Стяг;Затмение','mature campaign leader with weary determined face'],
      ['vasily-buslaev','Василий Буслаев','Vasily Buslaev','ru_epics','Мужчина','Человек','Молодой взрослый','h','Богатырь;Бунтарь','Сверхсила;Смелость','Палица;Новгородский колокол','reckless broad-shouldered young warrior with unruly energy'],
      ['dunay-ivanovich','Дунай Иванович','Dunay Ivanovich','ru_epics','Мужчина','Человек','Взрослый','h','Богатырь;Посол','Фехтование;Красноречие','Лук;Река','tragic mature warrior-diplomat with dark restrained expression'],
      ['alyonushka','Алёнушка','Alyonushka','ru_tales','Женщина','Человек','Молодой взрослый','e','Сестра;Защитник','Стойкость;Сострадание','Пруд;Платок','young adult village woman with gentle sorrowful face, non-glamorous beauty'],
      ['brother-ivanushka','Братец Иванушка','Brother Ivanushka','ru_tales','Мужчина','Заколдованный человек','Ребёнок','m','Брат;Жертва','Превращение;Доверчивость','Козлёнок;Копытце','small boy transformed toward a goat, innocent non-sensual portrayal'],
    ],
  },
]

// The remaining eight themes are deliberately kept in a separate compact source file so the
// editorial roster stays reviewable without turning this generator into an unreadable monolith.
const remainderPath = path.join(ROOT, 'data', 'characters', 'seeds', 'characters.expansion330.roster.json')
const remainder = JSON.parse(fs.readFileSync(remainderPath, 'utf8'))
themes.push(...remainder.themes)
Object.assign(works, remainder.works)

const split = (value) => String(value ?? '').split(';').map((entry) => entry.trim()).filter(Boolean)
const tier = {
  e: { difficulty: 'easy', recognitionLevel: 'mass', popularity: 0.9, recognition: 92, guessability: 91 },
  m: { difficulty: 'medium', recognitionLevel: 'mainstream', popularity: 0.76, recognition: 78, guessability: 77 },
  h: { difficulty: 'hard', recognitionLevel: 'niche', popularity: 0.58, recognition: 61, guessability: 59 },
}
const hardEditorialIds = new Set([
  'tyr', 'sif', 'skadi', 'idunn', 'freyr', 'hagen', 'kriemhild',
  'mikula-selyaninovich', 'volga-svyatoslavich', 'nastasya-mikulichna', 'chudo-yudo',
  'likho-one-eyed', 'mokosh', 'yaroslavna', 'prince-igor',
  'ole-lukoje', 'mother-holle', 'paper-ballerina', 'nightingale-andersen',
  'happy-prince', 'selfish-giant', 'ereshkigal', 'sha-wujing', 'white-bone-demon',
  'hou-yi', 'urashima-taro',
])
const era = (year, fallback) => {
  if (year == null) return fallback
  if (year < 500) return 'Античность'
  if (year < 1500) return 'Средневековье'
  if (year < 1600) return 'XVI век'
  if (year < 1700) return 'XVII век'
  if (year < 1800) return 'XVIII век'
  if (year < 1900) return 'XIX век'
  return 'XX век'
}
const perturb = (slug, span) => [...slug].reduce((sum, char) => sum + char.charCodeAt(0), 0) % span
const sourceLabel = (work) => work[5].includes('wikisource') ? `Викитека — ${work[0]}` : work[5].includes('gutenberg') ? `Project Gutenberg — ${work[0]}` : `Публичный первоисточник — ${work[0]}`

const sources = {}
const items = []
for (const theme of themes) {
  if (!Array.isArray(theme.rows) || theme.rows.length !== 30) throw new Error(`${theme.id}: expected exactly 30 characters`)
  for (const [index, row] of theme.rows.entries()) {
    if (!Array.isArray(row) || row.length !== 12) throw new Error(`${theme.id}:${index + 1}: expected 12 compact fields`)
    const [slug, titleRu, titleOriginal, workKey, gender, nature, ageGroup, tierKey, rolesRaw, abilitiesRaw, objectsRaw, visual] = row
    const work = works[workKey]
    if (!work) throw new Error(`${slug}: unknown work ${workKey}`)
    const effectiveTierKey = hardEditorialIds.has(slug) ? 'h' : tierKey
    const profile = tier[effectiveTierKey]
    if (!profile) throw new Error(`${slug}: unknown tier ${tierKey}`)
    const sourceKey = `work-${workKey}`
    sources[sourceKey] ??= [{ label: sourceLabel(work), url: work[5] }]
    const roles = split(rolesRaw)
    const abilities = split(abilitiesRaw)
    const objects = split(objectsRaw)
    const jitter = perturb(slug, 5)
    const itemEra = era(work[2], theme.era ?? 'Фольклорная традиция')
    const eraOrder = Number.isFinite(work[2]) ? work[2] : Number(theme.eraOrder ?? 1)
    const settings = [...new Set([...(theme.settings ?? []), nature === 'Человек' ? 'Общество' : 'Волшебный мир'])]
    const plotHint = `Этот персонаж действует как ${roles.join(' и ').toLocaleLowerCase('ru-RU')}, проявляет ${abilities.join(', ').toLocaleLowerCase('ru-RU')} и связан с такими мотивами, как ${objects.join(', ').toLocaleLowerCase('ru-RU')}. История разворачивается в пространстве: ${settings.slice(0, 3).join(', ').toLocaleLowerCase('ru-RU')}.`
    items.push({
      id: `character:${slug}`,
      slug,
      titleRu,
      titleOriginal,
      alternativeTitles: [],
      aliases: [],
      popularityScore: Number(Math.max(0.4, profile.popularity - jitter * 0.01).toFixed(2)),
      recognitionScore: profile.recognition - jitter,
      guessabilityScore: profile.guessability - Math.floor(jitter / 2),
      recognitionLevel: profile.recognitionLevel,
      characterDifficulty: profile.difficulty,
      dailyEligible: effectiveTierKey !== 'h',
      characterSourceWork: work[0],
      characterSourceAuthor: work[1],
      characterFirstAppearanceYear: work[2],
      characterEra: itemEra,
      characterEraOrder: eraOrder,
      characterSourceTypes: [work[3]],
      characterOriginCultures: [work[4]],
      characterNature: nature,
      characterGender: gender,
      characterAgeGroup: ageGroup,
      characterRoles: roles,
      characterArchetypes: roles,
      characterAbilities: abilities,
      characterSettings: settings,
      iconicObjects: objects,
      plotHint,
      rightsStatus: 'public_domain_source_reviewed',
      sourceKey,
      portraitDescription: `${visual}. Create a source-rooted original interpretation of this ${ageGroup.toLocaleLowerCase('ru-RU')} ${nature.toLocaleLowerCase('ru-RU')}. Distinguishing collage motifs: ${objects.join(', ')}. Period-appropriate opaque clothing where applicable; no recognizable screen adaptation, actor likeness, franchise costume, logo or typography.`,
    })
  }
}

if (themes.length !== 11) throw new Error(`Expected 11 editorial themes, found ${themes.length}`)
if (items.length !== 330) throw new Error(`Expected 330 characters, found ${items.length}`)
if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Duplicate character ids in expansion330')

const output = {
  batchId: 'character-expansion-330',
  targetLibraryCount: 400,
  selectionPolicy: {
    editorialThemes: themes.map((theme) => ({ id: theme.id, count: theme.rows.length })),
    principles: [
      'Ровно 330 новых идентичностей к существующим 70 карточкам',
      'Только мифология, фольклор и классические произведения с публичным первоисточником',
      'Баланс массовых, средних и сложных ответов; сложные карточки исключены из daily',
      'Культурное, гендерное, жанровое и типологическое разнообразие',
      'Никаких дублей одной личности под альтернативным именем и никаких современных франшиз',
    ],
  },
  sources,
  items,
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`character-expansion-330: ${items.length} curated cards written to ${path.relative(ROOT, OUTPUT)}`)
